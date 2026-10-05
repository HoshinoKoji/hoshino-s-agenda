package club.hoshino.agenda

import android.app.Application
import android.net.Uri
import club.hoshino.agenda.auth.*
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationServiceConfiguration
import net.openid.appauth.RegistrationRequest
import net.openid.appauth.RegistrationResponse
import net.openid.appauth.AuthState
import net.openid.appauth.NoClientAuthentication
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLHandshakeException

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class OAuthFailureTest {
    private val endpoint = "https://hoshinokoji.cloudflareaccess.com/cdn-cgi/access/oauth/token"

    @Test fun unwrapsAppAuthNetworkErrorIntoDnsTlsTimeoutOrConnectionDiagnosis() {
        val cases = listOf(
            UnknownHostException("secret-dns-detail") to "无法解析域名",
            SSLHandshakeException("secret-tls-detail") to "TLS",
            SocketTimeoutException("secret-timeout-detail") to "超时",
            ConnectException("secret-connection-detail") to "无法连接服务器",
        )
        for ((cause, expected) in cases) {
            val wrapped = AuthorizationException.fromTemplate(AuthorizationException.GeneralErrors.NETWORK_ERROR, IOException("secret-wrapper", cause))
            val failure = OAuthErrors.failure(OAuthStep.EXCHANGE, endpoint, wrapped)
            assertTrue(failure.message!!.contains("交换登录授权"))
            assertTrue(failure.message!!.contains("hoshinokoji.cloudflareaccess.com"))
            assertTrue(failure.message!!.contains(expected))
            assertFalse(failure.message!!.contains("secret"))
        }
    }

    @Test fun identifiesExpiredRefreshGrantWithoutEchoingTheServerDescription() {
        val expired = AuthorizationException.fromOAuthTemplate(
            AuthorizationException.TokenRequestErrors.INVALID_GRANT, "invalid_grant", "code=secret-token", null,
        )
        val failure = OAuthErrors.failure(OAuthStep.REFRESH, endpoint, expired)
        assertTrue(failure.message!!.contains("续期登录授权"))
        assertTrue(failure.message!!.contains("invalid_grant"))
        assertTrue(failure.message!!.contains("重新登录"))
        assertFalse(failure.message!!.contains("secret-token"))
    }

    @Test fun unknownErrorsNeverExposeRequestQueriesOrArbitraryServerValues() {
        val failure = OAuthErrors.failure(OAuthStep.REGISTRATION, "$endpoint?code=secret", IOException("refresh_token=secret"))
        assertFalse(failure.message!!.contains("secret"))
        val response = OAuthErrors.http(OAuthStep.REGISTRATION, endpoint, 400, """{"error":"secret-token","error_description":"secret-description"}""")
        assertTrue(response.message!!.contains("HTTP 400"))
        assertFalse(response.message!!.contains("secret"))
    }

    @Test fun appAuthModelsAcceptChinesePublicClientMetadataWithoutAClientSecret() {
        val config = AuthorizationServiceConfiguration(Uri.parse("https://hoshinokoji.cloudflareaccess.com/authorization"), Uri.parse(endpoint), Uri.parse("https://hoshinokoji.cloudflareaccess.com/registration"))
        val request = RegistrationRequest.Builder(config, listOf(Uri.parse(OAuthProtocol.CALLBACK)))
            .setTokenEndpointAuthenticationMethod("none")
            .setAdditionalParameters(mapOf("client_name" to "日迹 · Android")).build()
        val payload = request.toJsonString()
        assertEquals("日迹 · Android", JSONObject(payload).getString("client_name"))
        assertTrue(payload.toByteArray(Charsets.UTF_8).size > payload.length)
        val response = RegistrationResponse.Builder(request).fromResponseJson(JSONObject()
            .put("client_id", "public-client").put("token_endpoint_auth_method", "none")
            .put("redirect_uris", JSONArray().put(OAuthProtocol.CALLBACK))).build()
        assertEquals("public-client", response.clientId)
        assertNull(response.clientSecret)
        assertTrue(AuthState(response).clientAuthentication is NoClientAuthentication)
    }
}
