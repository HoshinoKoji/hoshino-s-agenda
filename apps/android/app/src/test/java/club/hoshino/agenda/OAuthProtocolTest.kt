package club.hoshino.agenda

import club.hoshino.agenda.auth.OAuthProtocol
import org.junit.Assert.*
import org.junit.Test

class OAuthProtocolTest {
    @Test fun readsOAuthMetadataWithoutRequiringOidcIdTokens() {
        val result = OAuthProtocol.discovery("""{"authorization_endpoint":"https://hoshinokoji.cloudflareaccess.com/oauth/authorize","token_endpoint":"https://hoshinokoji.cloudflareaccess.com/oauth/token","registration_endpoint":"https://agenda.hoshino.club/oauth/register","extra":"ignored"}""")
        assertEquals("https://hoshinokoji.cloudflareaccess.com/oauth/token", result.second)
    }

    @Test fun rejectsUntrustedMetadataBeforeSendingVerifierOrRefreshToken() {
        for (url in listOf("http://agenda.hoshino.club/token", "https://agenda.hoshino.club.evil.test/token", "https://user@agenda.hoshino.club/token", "https://agenda.hoshino.club:444/token", "https://agenda.hoshino.club/token#fragment")) {
            assertThrows(IllegalArgumentException::class.java) { OAuthProtocol.endpoint(url) }
        }
    }

    @Test fun callbackRequiresAnExactNonEmptyState() {
        assertFalse(OAuthProtocol.validCallbackState(null, null))
        assertFalse(OAuthProtocol.validCallbackState("", ""))
        assertFalse(OAuthProtocol.validCallbackState("attempt-a", "attempt-b"))
        assertTrue(OAuthProtocol.validCallbackState("attempt-a", "attempt-a"))
    }
}
