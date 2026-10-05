package club.hoshino.agenda.auth

import net.openid.appauth.RegistrationRequest
import net.openid.appauth.RegistrationResponse
import org.json.JSONObject

object OAuthRegistration {
    private val optionalFields = listOf(
        "client_id_issued_at", "client_secret", "client_secret_expires_at",
        "registration_access_token", "registration_client_uri", "token_endpoint_auth_method",
    )

    fun parse(request: RegistrationRequest, body: String): RegistrationResponse {
        val json = JSONObject(body)
        val clientId = json.opt("client_id")
        if (clientId !is String || clientId.isBlank()) {
            throw RegistrationResponse.MissingArgumentException("client_id")
        }
        // Optional JSON null means absent; AppAuth's has()/get*() parser does not treat it so.
        optionalFields.forEach { if (json.isNull(it)) json.remove(it) }
        // Cloudflare returns registration_client_uri without registration_access_token.
        // RFC 7592 management is unused by this client. Omit the incomplete optional pair,
        // rather than inventing a token or rejecting an otherwise valid public registration.
        if (json.has("registration_client_uri") != json.has("registration_access_token")) {
            json.remove("registration_client_uri")
            json.remove("registration_access_token")
        }
        return RegistrationResponse.Builder(request).fromResponseJson(json).build()
    }
}
