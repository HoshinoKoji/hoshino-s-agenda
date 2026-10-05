package club.hoshino.agenda.background

import android.content.Context
import androidx.work.*
import club.hoshino.agenda.AgendaApplication
import club.hoshino.agenda.data.LoginRequired
import kotlinx.coroutines.CancellationException
import java.util.concurrent.TimeUnit

class SyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val app = applicationContext as AgendaApplication
        return try { app.automaticSync(); Result.success() }
        catch (error: CancellationException) { throw error }
        catch (_: LoginRequired) { Result.failure() }
        catch (_: Exception) { if (runAttemptCount < 3) Result.retry() else Result.failure() }
    }
}

object SyncJobs {
    private fun constraints() = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
    fun periodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(30, TimeUnit.MINUTES, 15, TimeUnit.MINUTES)
            .setConstraints(constraints()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("agenda-periodic", ExistingPeriodicWorkPolicy.KEEP, request)
    }
    fun refresh(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork("agenda-refresh", ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(constraints()).build())
    }
    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork("agenda-periodic")
        WorkManager.getInstance(context).cancelUniqueWork("agenda-refresh")
    }
}
