package club.hoshino.agenda

import club.hoshino.agenda.data.AgendaHttp
import club.hoshino.agenda.data.LoginRequired
import club.hoshino.agenda.auth.OAuthFailure
import okhttp3.mockwebserver.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class AgendaHttpTest {
    private val server = MockWebServer().apply { start() }
    private val http = AgendaHttp()
    @After fun close() { server.shutdown() }

    @Test fun shortJsonBodiesAndCredentialHeadersAreHandled() {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("{}"))
        assertEquals("{}", http.json(server.url("/api/agenda").toString(), "opaque:token", "space@example.com"))
        val request = server.takeRequest()
        assertEquals("Bearer opaque:token", request.getHeader("Authorization"))
        assertEquals("space@example.com", request.getHeader("X-User-Email"))
    }

    @Test fun redirectsAreNotFollowedAndTokensAreNotSentToTheLoginPage() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", server.url("/login")))
        assertThrows(LoginRequired::class.java) { http.json(server.url("/api/agenda").toString(), "token") }
        assertEquals(1, server.requestCount)
    }

    @Test fun expiredAccessAndHtmlLoginResponsesRequestReauthentication() {
        for (code in listOf(401, 403)) {
            server.enqueue(MockResponse().setResponseCode(code))
            assertThrows(LoginRequired::class.java) { http.json(server.url("/").toString(), "token") }
        }
        server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody("<html>Access login</html>"))
        assertThrows(LoginRequired::class.java) { http.json(server.url("/").toString(), "token") }
    }

    @Test fun responseSizeLimitChecksTheStreamIncludingUnknownLength() {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setChunkedBody("12345", 2))
        assertThrows(IOException::class.java) { http.json(server.url("/").toString(), limit = 4) }
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("1234"))
        assertEquals("1234", http.json(server.url("/").toString(), limit = 4))
    }

    @Test fun registrationTransmitsTheCompleteUtf8JsonWithByteAccurateLength() {
        val payload = """{"client_name":"日迹 · Android 😀","redirect_uris":["https://agenda.hoshino.club/android/oauth/callback"],"token_endpoint_auth_method":"none"}"""
        server.enqueue(MockResponse().setResponseCode(201).setHeader("Content-Type", "application/json").setBody("""{"client_id":"public-client"}"""))
        assertEquals("""{"client_id":"public-client"}""", http.register(server.url("/registration").toString(), payload))
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("application/json", request.getHeader("Accept"))
        assertEquals("application/json; charset=utf-8", request.getHeader("Content-Type"))
        assertEquals(payload.toByteArray(Charsets.UTF_8).size.toString(), request.getHeader("Content-Length"))
        assertEquals(payload, request.body.readUtf8())
    }

    @Test fun registrationReportsHttpAndRedirectConfigurationErrorsWithoutEchoingSecrets() {
        server.enqueue(MockResponse().setResponseCode(400).setHeader("Content-Type", "application/json")
            .setBody("""{"error":"invalid_redirect_uri","error_description":"secret-code-and-token"}"""))
        val failure = assertThrows(OAuthFailure::class.java) { http.register(server.url("/registration").toString(), "{}") }
        assertTrue(failure.message!!.contains("注册登录客户端"))
        assertTrue(failure.message!!.contains("HTTP 400"))
        assertTrue(failure.message!!.contains("Allowed redirect URIs"))
        assertFalse(failure.message!!.contains("secret-code-and-token"))
    }

    @Test fun registrationDoesNotFollowRedirectsAndKeepsTheStatusOfLargeHtmlErrors() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", server.url("/login")))
        val redirect = assertThrows(OAuthFailure::class.java) { http.register(server.url("/registration").toString(), "{}") }
        assertTrue(redirect.message!!.contains("HTTP 302"))
        assertEquals(1, server.requestCount)
        server.enqueue(MockResponse().setResponseCode(403).setHeader("Content-Type", "text/html").setBody("private-data".repeat(1000)))
        val blocked = assertThrows(OAuthFailure::class.java) { http.register(server.url("/registration").toString(), "{}") }
        assertTrue(blocked.message!!.contains("HTTP 403"))
        assertFalse(blocked.message!!.contains("private-data"))
    }

    @Test fun registrationRejectsSuccessfulHtmlInsteadOfPersistingALoginPage() {
        server.enqueue(MockResponse().setHeader("Content-Type", "text/html").setBody("<html>Access login</html>"))
        val failure = assertThrows(OAuthFailure::class.java) { http.register(server.url("/registration").toString(), "{}") }
        assertTrue(failure.message!!.contains("未返回 JSON"))
    }
}
