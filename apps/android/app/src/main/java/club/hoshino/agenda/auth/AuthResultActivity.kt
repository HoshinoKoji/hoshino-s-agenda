package club.hoshino.agenda.auth

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import club.hoshino.agenda.AgendaApplication
import club.hoshino.agenda.MainActivity
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

open class AuthResultActivity : Activity() {
    protected open suspend fun accept(app: AgendaApplication, intent: Intent): Boolean = app.oauth.complete(intent)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as AgendaApplication
        app.scope.launch {
            try {
                if (accept(app, intent)) {
                    app.settings.status("")
                    app.sync()
                }
            } catch (error: Exception) {
                app.settings.status(error.message ?: "登录失败，请重试", error is club.hoshino.agenda.data.LoginRequired)
            } finally {
                withContext(Dispatchers.Main) {
                    startActivity(Intent(this@AuthResultActivity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
                    finish()
                }
            }
        }
    }
}
