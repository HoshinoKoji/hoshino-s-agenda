package club.hoshino.agenda.auth

import android.net.Uri
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationRequest
import net.openid.appauth.AuthorizationResponse

object OAuthRedirect {
    const val SCHEME = "club.hoshino.agenda"
    private val parameters = setOf("state", "code", "error")

    fun parse(expected: AuthorizationRequest, uri: Uri): Pair<AuthorizationResponse?, AuthorizationException?> {
        require(uri.scheme == SCHEME && uri.encodedAuthority == "oauth" && uri.path == "/callback" && uri.fragment == null) { "登录回跳地址无效，请重新登录" }
        require(uri.queryParameterNames.all { it in parameters }) { "登录回跳参数无效，请重新登录" }
        require(uri.getQueryParameters("state").size == 1 && OAuthProtocol.validCallbackState(expected.state, uri.getQueryParameter("state"))) { "授权回跳与当前登录不匹配，请重新登录" }
        val codes = uri.getQueryParameters("code")
        val errors = uri.getQueryParameters("error")
        require((codes.size == 1 && errors.isEmpty() && codes.single().isNotEmpty() && codes.single().length <= 8192)
            || (errors.size == 1 && codes.isEmpty() && errors.single().isNotEmpty() && errors.single().length <= 128)) { "登录回跳结果无效，请重新登录" }
        if (errors.isNotEmpty()) return null to AuthorizationException.fromOAuthRedirect(uri)
        // The request comes from encrypted local storage. In particular, its redirect_uri
        // remains the registered HTTPS URI and its PKCE verifier is never taken from the URL.
        return AuthorizationResponse.Builder(expected).fromUri(uri).build() to null
    }
}
