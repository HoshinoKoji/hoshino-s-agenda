package club.hoshino.agenda.auth

import android.content.Intent
import club.hoshino.agenda.AgendaApplication
import club.hoshino.agenda.data.LoginRequired

class OAuthLinkActivity : AuthResultActivity() {
    override suspend fun accept(app: AgendaApplication, intent: Intent): Boolean {
        val uri = intent.data ?: throw LoginRequired("登录回跳没有结果，请重新登录")
        return app.oauth.completeRedirect(uri)
    }
}
