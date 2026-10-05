package club.hoshino.agenda

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import club.hoshino.agenda.auth.*
import club.hoshino.agenda.data.AgendaHttp
import club.hoshino.agenda.data.LoginRequired
import kotlinx.coroutines.runBlocking
import net.openid.appauth.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class OAuthRedirectTest {
    private val config = AuthorizationServiceConfiguration(Uri.parse("https://hoshinokoji.cloudflareaccess.com/authorization"), Uri.parse("https://hoshinokoji.cloudflareaccess.com/token"))
    private val expected = AuthorizationRequest.Builder(config, "public-client", ResponseTypeValues.CODE, Uri.parse(OAuthProtocol.CALLBACK))
        .setState("expected-state").setAdditionalParameters(mapOf("resource" to OAuthProtocol.RESOURCE)).build()

    @Test fun manualHandoffUsesTheOriginalHttpsRedirectAndPkceVerifier() {
        val (response, error) = OAuthRedirect.parse(expected, Uri.parse("club.hoshino.agenda://oauth/callback?state=expected-state&code=code%2Bwith%2Fcharacters"))
        assertNull(error)
        val token = requireNotNull(response).createTokenExchangeRequest(mapOf("resource" to OAuthProtocol.RESOURCE))
        assertEquals("code+with/characters", token.authorizationCode)
        assertEquals(Uri.parse(OAuthProtocol.CALLBACK), token.redirectUri)
        assertEquals(expected.codeVerifier, token.codeVerifier)
        assertEquals(OAuthProtocol.RESOURCE, token.additionalParameters["resource"])
        assertSame(expected, response.request)
    }

    @Test fun rejectsMissingWrongOrDuplicateStateBeforeAcceptingTheCode() {
        for (query in listOf("code=x", "code=x&state=wrong", "code=x&state=expected-state&state=wrong")) {
            assertThrows(IllegalArgumentException::class.java) { OAuthRedirect.parse(expected, Uri.parse("club.hoshino.agenda://oauth/callback?$query")) }
        }
    }

    @Test fun rejectsOtherAddressesAndUnexpectedOrAmbiguousResults() {
        for (address in listOf("https://oauth/callback", "club.hoshino.agenda://other/callback", "club.hoshino.agenda://user@oauth/callback", "club.hoshino.agenda://oauth:443/callback", "club.hoshino.agenda://oauth/other")) {
            assertThrows(IllegalArgumentException::class.java) { OAuthRedirect.parse(expected, Uri.parse("$address?state=expected-state&code=x")) }
        }
        for (query in listOf("state=expected-state", "state=expected-state&code=", "state=expected-state&code=a&code=b", "state=expected-state&code=x&error=access_denied", "state=expected-state&code=x&access_token=untrusted", "state=expected-state&code=x#fragment")) {
            assertThrows(IllegalArgumentException::class.java) { OAuthRedirect.parse(expected, Uri.parse("club.hoshino.agenda://oauth/callback?$query")) }
        }
    }

    @Test fun errorHandoffsAlsoRequireTheCurrentState() {
        val (response, error) = OAuthRedirect.parse(expected, Uri.parse("club.hoshino.agenda://oauth/callback?state=expected-state&error=access_denied"))
        assertNull(response)
        assertEquals("access_denied", error!!.error)
        assertThrows(IllegalArgumentException::class.java) { OAuthRedirect.parse(expected, Uri.parse("club.hoshino.agenda://oauth/callback?state=wrong&error=access_denied")) }
    }

    @Test fun manifestRoutesManualLinksToTheAppWithoutClaimingOrdinaryWebPages() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        fun resolve(uri: String) = context.packageManager.resolveActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(context.packageName), 0)?.activityInfo?.name
        assertEquals(OAuthLinkActivity::class.java.name, resolve("club.hoshino.agenda://oauth/callback?state=s&code=c"))
        assertEquals(RedirectUriReceiverActivity::class.java.name, resolve(OAuthProtocol.CALLBACK))
        assertNull(resolve("${OAuthProtocol.ORIGIN}/?editEntry=entry"))
    }

    @Test fun missingAttemptsRejectManualReplayAndIgnoreLateSdkCancellation() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val manager = OAuthManager(context, AgendaHttp())
        try {
            manager.completeRedirect(Uri.parse("club.hoshino.agenda://oauth/callback?state=old&code=replay"))
            fail("Manual callbacks must have a locally stored attempt")
        } catch (error: LoginRequired) { assertTrue(error.message!!.contains("过期")) }
        val cancel = AuthorizationException.fromTemplate(AuthorizationException.GeneralErrors.USER_CANCELED_AUTH_FLOW, null).toIntent()
        assertFalse(manager.complete(cancel))
    }
}
