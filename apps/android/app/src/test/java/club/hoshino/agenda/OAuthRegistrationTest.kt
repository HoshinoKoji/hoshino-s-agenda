package club.hoshino.agenda

import android.app.Application
import android.net.Uri
import club.hoshino.agenda.auth.OAuthProtocol
import club.hoshino.agenda.auth.OAuthRegistration
import net.openid.appauth.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = Application::class)
class OAuthRegistrationTest {
    private val config = AuthorizationServiceConfiguration(
        Uri.parse("https://hoshinokoji.cloudflareaccess.com/cdn-cgi/access/oauth/authorization"),
        Uri.parse("https://hoshinokoji.cloudflareaccess.com/cdn-cgi/access/oauth/token"),
        Uri.parse("https://hoshinokoji.cloudflareaccess.com/cdn-cgi/access/oauth/registration"),
    )
    private val request = RegistrationRequest.Builder(config, listOf(Uri.parse(OAuthProtocol.CALLBACK)))
        .setTokenEndpointAuthenticationMethod("none").build()
    private fun fixture(): String = requireNotNull(javaClass.getResourceAsStream("/oauth/cloudflare-registration.json"))
        .bufferedReader().use { it.readText() }

    @Test fun reproducesTheOriginalParserFailureWithCloudflaresActualResponseShape() {
        val error = assertThrows(RegistrationResponse.MissingArgumentException::class.java) {
            RegistrationResponse.Builder(request).fromResponseJson(JSONObject(fixture())).build()
        }
        assertEquals("registration_access_token", error.missingField)
    }

    @Test fun acceptsTheLiveResponseShapeAndKeepsThePublicClientUsableAfterPersistence() {
        val response = OAuthRegistration.parse(request, fixture())
        assertEquals("00000000-0000-4000-8000-000000000001", response.clientId)
        assertEquals(1791170834L, response.clientIdIssuedAt)
        assertNull(response.clientSecret)
        assertNull(response.registrationClientUri)
        assertNull(response.registrationAccessToken)
        assertTrue(AuthState(response).clientAuthentication is NoClientAuthentication)
        val restored = AuthState.jsonDeserialize(AuthState(response).jsonSerializeString())
        assertEquals(response.clientId, restored.lastRegistrationResponse!!.clientId)
        assertEquals("none", restored.lastRegistrationResponse!!.tokenEndpointAuthMethod)
        assertTrue(restored.clientAuthentication is NoClientAuthentication)
        val authorization = AuthorizationRequest.Builder(config, response.clientId, ResponseTypeValues.CODE, Uri.parse(OAuthProtocol.CALLBACK))
            .setAdditionalParameters(mapOf("resource" to OAuthProtocol.RESOURCE)).build().toUri()
        assertEquals(response.clientId, authorization.getQueryParameter("client_id"))
        assertEquals("S256", authorization.getQueryParameter("code_challenge_method"))
        assertEquals(OAuthProtocol.RESOURCE, authorization.getQueryParameter("resource"))
    }

    @Test fun keepsCompleteRegistrationManagementCredentials() {
        val json = JSONObject(fixture()).put("registration_access_token", "fixture-management-token")
        val response = OAuthRegistration.parse(request, json.toString())
        assertEquals(config.registrationEndpoint, response.registrationClientUri)
        assertEquals("fixture-management-token", response.registrationAccessToken)
    }

    @Test fun treatsExplicitNullOptionalFieldsAsAbsent() {
        val json = JSONObject(fixture())
        listOf("client_id_issued_at", "client_secret", "client_secret_expires_at", "registration_access_token", "registration_client_uri", "token_endpoint_auth_method")
            .forEach { json.put(it, JSONObject.NULL) }
        val response = OAuthRegistration.parse(request, json.toString())
        assertNull(response.clientIdIssuedAt)
        assertNull(response.clientSecret)
        assertNull(response.registrationAccessToken)
        assertNull(response.registrationClientUri)
        assertTrue(AuthState(response).clientAuthentication is NoClientAuthentication)
    }

    @Test fun doesNotAcceptMissingNullEmptyOrNonStringClientIds() {
        for (value in listOf(JSONObject.NULL, "", " ", 123, JSONObject())) {
            val error = assertThrows(RegistrationResponse.MissingArgumentException::class.java) {
                OAuthRegistration.parse(request, JSONObject(fixture()).put("client_id", value).toString())
            }
            assertEquals("client_id", error.missingField)
        }
        val json = JSONObject(fixture()).apply { remove("client_id") }
        assertThrows(RegistrationResponse.MissingArgumentException::class.java) { OAuthRegistration.parse(request, json.toString()) }
    }

    @Test fun stillRejectsConfidentialCredentialsWithoutTheirRequiredExpiry() {
        val json = JSONObject(fixture()).put("client_secret", "fixture-client-secret")
        val error = assertThrows(RegistrationResponse.MissingArgumentException::class.java) { OAuthRegistration.parse(request, json.toString()) }
        assertEquals("client_secret_expires_at", error.missingField)
    }
}
