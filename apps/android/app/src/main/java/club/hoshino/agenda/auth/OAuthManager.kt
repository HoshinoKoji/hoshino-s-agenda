package club.hoshino.agenda.auth

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import club.hoshino.agenda.data.AgendaHttp
import club.hoshino.agenda.data.LoginRequired
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import net.openid.appauth.*
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class OAuthManager(context: Context, private val http: AgendaHttp) {
    private val store = SecureAuthStore(context)
    private val service = AuthorizationService(context)
    private val mutex = Mutex()
    private val resource = mapOf("resource" to OAuthProtocol.RESOURCE)

    private fun state(): AuthState = store.get("state")?.let(AuthState::jsonDeserialize) ?: AuthState()
    private fun save(state: AuthState) = store.put("state", state.jsonSerializeString())
    suspend fun authorized(): Boolean = mutex.withLock { withContext(Dispatchers.IO) { runCatching { state().isAuthorized }.getOrDefault(false) } }

    suspend fun begin(context: Context) = mutex.withLock {
        withContext(Dispatchers.IO) {
            val endpoints = try {
                OAuthProtocol.discovery(http.json(OAuthProtocol.DISCOVERY))
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                throw OAuthErrors.failure(OAuthStep.DISCOVERY, OAuthProtocol.DISCOVERY, error)
            }
            val config = AuthorizationServiceConfiguration(Uri.parse(endpoints.first), Uri.parse(endpoints.second), Uri.parse(endpoints.third))
            val current = runCatching { state() }.getOrElse { store.clear(); AuthState() }
            var registration = current.lastRegistrationResponse
            if (registration == null || current.hasClientSecretExpired() || registration.request.configuration.tokenEndpoint != config.tokenEndpoint) {
                val request = RegistrationRequest.Builder(config, listOf(Uri.parse(OAuthProtocol.CALLBACK)))
                    .setResponseTypeValues("code").setGrantTypeValues("authorization_code", "refresh_token")
                    .setTokenEndpointAuthenticationMethod("none")
                    .setAdditionalParameters(mapOf("client_name" to "日迹 · Android"))
                    .build()
                val endpoint = requireNotNull(config.registrationEndpoint).toString()
                val response = http.register(endpoint, request.toJsonString())
                registration = try {
                    OAuthRegistration.parse(request, response)
                } catch (error: RegistrationResponse.MissingArgumentException) {
                    throw OAuthFailure(OAuthStep.REGISTRATION, endpoint, "注册信息缺少必需字段 ${error.missingField}，请重试", error)
                } catch (error: Exception) {
                    throw OAuthFailure(OAuthStep.REGISTRATION, endpoint, "Access 返回的客户端注册信息不完整，请重试", error)
                }
            }
            val registered = requireNotNull(registration)
            val fresh = AuthState(registered)
            val request = AuthorizationRequest.Builder(config, registered.clientId, ResponseTypeValues.CODE, Uri.parse(OAuthProtocol.CALLBACK))
                .setAdditionalParameters(resource).build()
            save(fresh)
            store.put("pending", request.jsonSerializeString())
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            val complete = PendingIntent.getActivity(context, 11, Intent(context, AuthResultActivity::class.java), flags)
            val cancel = PendingIntent.getActivity(context, 12, Intent(context, AuthResultActivity::class.java), flags)
            withContext(Dispatchers.Main) {
                try { service.performAuthorizationRequest(request, complete, cancel) }
                catch (_: android.content.ActivityNotFoundException) {
                    throw OAuthFailure(OAuthStep.BROWSER, endpoints.first, "未找到可用于登录的浏览器")
                }
            }
        }
    }

    suspend fun complete(intent: Intent): Boolean = mutex.withLock {
        withContext(Dispatchers.IO + NonCancellable) {
            val response = AuthorizationResponse.fromIntent(intent)
            val error = AuthorizationException.fromIntent(intent)
            val pending = store.get("pending")
            // An explicit browser handoff can complete while AppAuth's old browser task is
            // closing. Its late cancellation must not overwrite the accepted login result.
            if (pending == null && error?.type == AuthorizationException.TYPE_GENERAL_ERROR &&
                error.code in listOf(AuthorizationException.GeneralErrors.USER_CANCELED_AUTH_FLOW.code, AuthorizationException.GeneralErrors.PROGRAM_CANCELED_AUTH_FLOW.code)) return@withContext false
            val expected = pending?.let(AuthorizationRequest::jsonDeserialize) ?: throw LoginRequired("登录请求已过期，请重新开始")
            if (response == null) {
                store.put("pending", null)
                throw LoginRequired(if (error?.error == "access_denied") "Access 拒绝了登录" else "登录未完成，请重试")
            }
            finish(expected, response)
            true
        }
    }

    suspend fun completeRedirect(uri: Uri): Boolean = mutex.withLock {
        withContext(Dispatchers.IO + NonCancellable) {
            val expected = store.get("pending")?.let(AuthorizationRequest::jsonDeserialize) ?: throw LoginRequired("登录请求已过期，请回到 App 重新登录")
            val (response, error) = OAuthRedirect.parse(expected, uri)
            if (response == null) {
                store.put("pending", null)
                throw LoginRequired(if (error?.error == "access_denied") "Access 拒绝了登录" else "Access 未完成授权，请重新登录")
            }
            finish(expected, response)
            true
        }
    }

    private suspend fun finish(expected: AuthorizationRequest, response: AuthorizationResponse) {
        require(OAuthProtocol.validCallbackState(expected.state, response.state) && response.request.jsonSerializeString() == expected.jsonSerializeString()) { "授权回跳与本次登录不匹配" }
        // Consume before exchanging the one-time code. Both HTTPS and manual handoffs use
        // the same lock, PKCE request and registered HTTPS redirect URI.
        store.put("pending", null)
        val current = state()
        current.update(response, null)
        val tokenRequest = response.createTokenExchangeRequest(resource)
        val token: TokenResponse = suspendCancellableCoroutine { continuation ->
            service.performTokenRequest(tokenRequest, current.clientAuthentication) { result, failure ->
                if (result != null) continuation.resume(result)
                else continuation.resumeWithException(OAuthErrors.failure(OAuthStep.EXCHANGE, tokenRequest.configuration.tokenEndpoint.toString(), failure ?: LoginRequired()))
            }
        }
        require(!token.accessToken.isNullOrEmpty() && !token.refreshToken.isNullOrEmpty()) { "Access 未返回可续期授权，请检查 Managed OAuth grant 配置" }
        current.update(token, null)
        save(current)
    }

    suspend fun token(forceRefresh: Boolean = false): String = mutex.withLock {
        withContext(Dispatchers.IO + NonCancellable) {
            val current = runCatching { state() }.getOrElse { throw LoginRequired("本机授权无法读取，请重新登录") }
            if (!current.isAuthorized) throw LoginRequired("请先登录 Cloudflare Access")
            if (forceRefresh) current.setNeedsTokenRefresh(true)
            val result: Pair<String?, AuthorizationException?> = suspendCancellableCoroutine { continuation ->
                current.performActionWithFreshTokens(service, resource) { accessToken, _, error -> continuation.resume(accessToken to error) }
            }
            // Persist rotated refresh tokens even if the worker/activity was cancelled during the exchange.
            save(current)
            if (result.first.isNullOrEmpty()) {
                val failure = OAuthErrors.failure(OAuthStep.REFRESH, requireNotNull(current.authorizationServiceConfiguration).tokenEndpoint.toString(), result.second ?: LoginRequired())
                if (result.second?.type == AuthorizationException.TYPE_OAUTH_TOKEN_ERROR || current.refreshToken == null) throw LoginRequired(failure.message ?: "授权已失效，请重新登录")
                throw failure
            }
            result.first!!
        }
    }

    suspend fun disconnect() = mutex.withLock { withContext(Dispatchers.IO) { store.clear() } }
}
