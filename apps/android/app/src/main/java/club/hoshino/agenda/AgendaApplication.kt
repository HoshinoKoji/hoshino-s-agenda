package club.hoshino.agenda

import android.app.Application
import club.hoshino.agenda.auth.OAuthManager
import club.hoshino.agenda.data.*
import club.hoshino.agenda.background.ReminderScheduler
import club.hoshino.agenda.background.SyncJobs
import club.hoshino.agenda.widget.AgendaWidget
import androidx.glance.appwidget.updateAll
import androidx.work.Configuration
import kotlinx.coroutines.*

class AgendaApplication : Application(), Configuration.Provider {
    override val workManagerConfiguration get() = Configuration.Builder().build()
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val settings by lazy { AgendaSettings(this) }
    val http by lazy { AgendaHttp() }
    val oauth by lazy { OAuthManager(this, http) }
    val database by lazy { AgendaDatabase.create(this) }
    val repository by lazy { AgendaRepository(database, settings, oauth, http) }

    override fun onCreate() {
        super.onCreate()
        ReminderScheduler.channel(this)
        SyncJobs.periodic(this)
        scope.launch {
            runCatching { ReminderScheduler.schedule(this@AgendaApplication) }
        }
    }

    suspend fun reconcile() {
        ReminderScheduler.schedule(this)
        AgendaWidget().updateAll(this)
    }

    suspend fun sync() {
        try { repository.sync() }
        finally { reconcile() }
    }

    suspend fun automaticSync() {
        // A failed/cancelled login has no usable grant. Returning to the foreground must not
        // overwrite its detailed diagnostic with the generic "please log in" sync error.
        // The same rule applies to automatic background refreshes.
        if (oauth.authorized()) sync() else reconcile()
    }
}
