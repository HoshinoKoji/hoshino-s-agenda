package club.hoshino.agenda.auth

import kotlinx.serialization.json.*
import java.net.URI

object OAuthProtocol {
    const val ORIGIN = "https://agenda.hoshino.club"
    // Match the exact resource URI advertised by /.well-known/oauth-protected-resource.
    const val RESOURCE = ORIGIN
    const val CALLBACK = "$ORIGIN/android/oauth/callback"
    const val DISCOVERY = "$ORIGIN/.well-known/oauth-authorization-server"
    private val trustedHosts = setOf("agenda.hoshino.club", "hoshinokoji.cloudflareaccess.com")

    fun endpoint(value: String): String {
        val uri = URI(value)
        require(uri.scheme == "https" && uri.host in trustedHosts && uri.rawUserInfo == null && uri.port in listOf(-1, 443) && uri.fragment == null) { "Access 返回了不受信任的授权地址" }
        return value
    }

    fun discovery(body: String): Triple<String, String, String> {
        val data = Json.parseToJsonElement(body).jsonObject
        fun field(name: String) = endpoint(data[name]?.jsonPrimitive?.content ?: error("Access 未提供 $name；请检查 Managed OAuth 配置"))
        return Triple(field("authorization_endpoint"), field("token_endpoint"), field("registration_endpoint"))
    }

    fun validCallbackState(expected: String?, actual: String?): Boolean = !expected.isNullOrEmpty() && expected == actual
}
