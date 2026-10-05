package club.hoshino.agenda.auth

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.openid.appauth.AuthorizationException
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.URI
import java.net.UnknownHostException
import javax.net.ssl.SSLException

enum class OAuthStep(val label: String) {
    DISCOVERY("读取 OAuth 配置"), REGISTRATION("注册登录客户端"),
    BROWSER("打开登录浏览器"), EXCHANGE("交换登录授权"), REFRESH("续期登录授权"),
}

class OAuthFailure(val step: OAuthStep, endpoint: String, detail: String, cause: Throwable? = null) : IOException(
    "${step.label}失败（${runCatching { URI(endpoint).host }.getOrNull() ?: "Access"}）：$detail", cause,
)

object OAuthErrors {
    // Only protocol error identifiers are displayed. Free-form server text and exception
    // messages may contain request URLs, authorization codes or tokens and are not echoed.
    private val descriptions = mapOf(
        "invalid_redirect_uri" to "回跳地址未被允许，请检查 Managed OAuth 的 Allowed redirect URIs",
        "invalid_client_metadata" to "客户端注册配置被拒绝，请检查动态注册和回跳地址设置",
        "invalid_request" to "授权请求被拒绝，请检查 Managed OAuth 配置",
        "invalid_client" to "客户端注册已失效，请重新发起登录",
        "invalid_grant" to "本次授权已失效，请重新登录",
        "unauthorized_client" to "此客户端未获准使用该授权方式",
        "unsupported_grant_type" to "服务器不支持请求的授权方式",
        "invalid_scope" to "服务器不允许请求的授权范围",
        "access_denied" to "Access 拒绝了本次授权",
        "server_error" to "Access 服务暂时出错，请稍后重试",
        "temporarily_unavailable" to "Access 服务暂时不可用，请稍后重试",
    )

    fun http(step: OAuthStep, endpoint: String, status: Int, body: String): OAuthFailure {
        val code = runCatching { Json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.content }.getOrNull()
        val detail = descriptions[code]?.let { "$code：$it" }
            ?: if (status == 401 || status == 403 || status in 300..399) "请求被拒绝或跳转，请检查该端点的 Access / 网络策略"
            else "服务请求失败，请稍后重试"
        return OAuthFailure(step, endpoint, "HTTP $status，$detail")
    }

    fun failure(step: OAuthStep, endpoint: String, error: Throwable): OAuthFailure {
        if (error is OAuthFailure) return error
        val causes = generateSequence(error) { it.cause }.take(8).toList()
        val detail = when {
            causes.any { it is UnknownHostException } -> "无法解析域名，请检查网络或 DNS"
            causes.any { it is SSLException } -> "TLS 连接失败，请检查网络代理及手机时间"
            causes.any { it is SocketTimeoutException } -> "连接超时，请稍后重试"
            causes.any { it is ConnectException } -> "无法连接服务器，请检查网络"
            error is AuthorizationException && descriptions.containsKey(error.error) -> "${error.error}：${descriptions[error.error]}"
            step == OAuthStep.DISCOVERY && error.message?.startsWith("OAuth 发现请求被 Access") == true -> "发现请求被 Access 拦截，请检查 Managed OAuth 设置"
            step == OAuthStep.DISCOVERY && error.message?.startsWith("Access 返回了登录页面") == true -> "发现端点返回了登录页，请检查 Managed OAuth 设置"
            error is IOException -> "网络请求失败，请检查网络连接后重试"
            else -> "服务响应或配置无法处理，请重试"
        }
        return OAuthFailure(step, endpoint, detail, error)
    }
}
