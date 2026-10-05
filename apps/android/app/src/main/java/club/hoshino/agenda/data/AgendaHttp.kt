package club.hoshino.agenda.data

import club.hoshino.agenda.auth.OAuthProtocol
import club.hoshino.agenda.auth.OAuthErrors
import club.hoshino.agenda.auth.OAuthFailure
import club.hoshino.agenda.auth.OAuthStep
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody
import okio.Buffer
import java.io.IOException
import java.util.concurrent.TimeUnit

class LoginRequired(message: String = "授权已失效，请重新登录 Access") : IOException(message)

class AgendaHttp(private val client: OkHttpClient = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false)
    .connectTimeout(15, TimeUnit.SECONDS).callTimeout(30, TimeUnit.SECONDS).build()) {

    fun json(url: String, token: String? = null, email: String? = null, limit: Long = 1024 * 1024): String {
        val request = Request.Builder().url(url).header("Accept", "application/json")
        token?.let { request.header("Authorization", "Bearer $it") }
        email?.let { request.header("X-User-Email", it) }
        client.newCall(request.build()).execute().use { response ->
            if (response.code == 401 || response.code == 403 || response.isRedirect) {
                if (token != null) throw LoginRequired()
                throw IOException("OAuth 发现请求被 Access 拦截，请先开启 Managed OAuth 并确认发现端点可用")
            }
            if (!response.isSuccessful) throw IOException("服务请求失败（HTTP ${response.code}）")
            val body = response.body ?: throw IOException("服务没有返回数据")
            if (body.contentType()?.subtype?.contains("json") != true) {
                if (token != null) throw LoginRequired()
                throw IOException("Access 返回了登录页面，请先开启 Managed OAuth")
            }
            return readBounded(body, limit)
        }
    }

    fun register(endpoint: String, payload: String): String {
        try {
            // AppAuth 0.11.1's registration task uses String.length() as Content-Length.
            // OkHttp writes UTF-8 bytes and computes their length, including Chinese client_name.
            val request = Request.Builder().url(endpoint).header("Accept", "application/json")
                .post(payload.toRequestBody("application/json; charset=utf-8".toMediaType())).build()
            client.newCall(request).execute().use { response ->
                val body = response.body ?: throw OAuthFailure(OAuthStep.REGISTRATION, endpoint, "服务没有返回数据")
                if (!response.isSuccessful) {
                    throw OAuthErrors.http(OAuthStep.REGISTRATION, endpoint, response.code, readBounded(body, 4096, truncate = true))
                }
                if (body.contentType()?.subtype?.contains("json") != true) {
                    throw OAuthFailure(OAuthStep.REGISTRATION, endpoint, "服务未返回 JSON（HTTP ${response.code}）")
                }
                return readBounded(body, 1024 * 1024)
            }
        } catch (error: IOException) {
            throw OAuthErrors.failure(OAuthStep.REGISTRATION, endpoint, error)
        }
    }

    private fun readBounded(body: ResponseBody, limit: Long, truncate: Boolean = false): String {
        val buffer = Buffer()
        val source = body.source()
        while (buffer.size <= limit && source.read(buffer, minOf(8192, limit + 1 - buffer.size)) != -1L) { /* bounded stream */ }
        if (buffer.size > limit && !truncate) throw IOException("返回的数据过大，请缩小数据空间后重试")
        if (truncate) return buffer.readUtf8(minOf(buffer.size, limit))
        return buffer.readUtf8()
    }

    fun agenda(token: String, email: String): AgendaPayload = AgendaRules.decode(json("${OAuthProtocol.ORIGIN}/api/agenda", token, email, 16L * 1024 * 1024))
}
