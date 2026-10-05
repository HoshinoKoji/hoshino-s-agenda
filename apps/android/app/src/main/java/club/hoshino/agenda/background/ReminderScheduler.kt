package club.hoshino.agenda.background

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import club.hoshino.agenda.AgendaApplication
import club.hoshino.agenda.MainActivity
import club.hoshino.agenda.R
import club.hoshino.agenda.data.AgendaRules
import club.hoshino.agenda.widget.AgendaWidget
import androidx.glance.appwidget.updateAll
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime

object ReminderScheduler {
    const val DAILY = "club.hoshino.agenda.DAILY_SUMMARY"
    const val ROLLOVER = "club.hoshino.agenda.DAY_ROLLOVER"
    private const val CHANNEL = "daily-summary"
    private val mutex = Mutex()

    fun exactAllowed(context: Context): Boolean = Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    private fun intent(context: Context, action: String, code: Int, extras: Intent.() -> Unit = {}): PendingIntent = PendingIntent.getBroadcast(
        context, code, Intent(context, ReminderReceiver::class.java).setAction(action).apply(extras),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    suspend fun schedule(context: Context, force: Boolean = false) = mutex.withLock {
        val app = context.applicationContext as AgendaApplication
        val snapshot = app.repository.current()
        val config = snapshot.settings
        val manager = context.getSystemService(AlarmManager::class.java)
        manager.cancel(intent(context, ROLLOVER, 22))
        if (config.email.isBlank() || snapshot.syncedAt == null || !config.reminderEnabled) {
            manager.cancel(intent(context, DAILY, 21))
            app.settings.scheduled("", 0)
            context.getSystemService(NotificationManager::class.java).cancel(9)
            if (snapshot.syncedAt == null || config.email.isBlank()) return@withLock
        }
        val now = ZonedDateTime.now()
        val midnight = now.toLocalDate().plusDays(1).atStartOfDay(now.zone)
        manager.set(AlarmManager.RTC, midnight.toInstant().toEpochMilli(), intent(context, ROLLOVER, 22))
        if (!config.reminderEnabled) return@withLock
        val signature = "${config.revision}:${config.hour}:${config.minute}:${now.zone.id}:${exactAllowed(context)}"
        val scheduled = app.settings.scheduled()
        val oldDate = java.time.Instant.ofEpochMilli(scheduled.second).atZone(now.zone).toLocalDate()
        // Preserve a same-day inexact alarm that is still awaiting OS delivery; a sync after 09:00
        // must not cancel it and silently move the daily summary to tomorrow.
        if (!force && scheduled.first == signature && !oldDate.isBefore(now.toLocalDate())) return@withLock
        manager.cancel(intent(context, DAILY, 21))
        val next = AgendaRules.nextReminder(now, LocalTime.of(config.hour, config.minute))
        val operation = intent(context, DAILY, 21) {
            putExtra("revision", config.revision)
            putExtra("date", next.toLocalDate().toString())
            putExtra("hour", config.hour)
            putExtra("minute", config.minute)
        }
        val at = next.toInstant().toEpochMilli()
        if (exactAllowed(context)) {
            try { manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, operation); app.settings.scheduled(signature, at); return@withLock }
            catch (_: SecurityException) { /* Permission may have been revoked between the check and scheduling. */ }
        }
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, operation)
        app.settings.scheduled(signature, at)
    }

    fun channel(context: Context) {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL, "每日事项汇总", NotificationManager.IMPORTANCE_DEFAULT))
    }

    suspend fun scheduleAfterEvent(context: Context, action: String?) {
        // A non-wakeup midnight update may arrive after 09:00 on a sleeping phone. Like a
        // normal sync, it must preserve today's alarm; only delivery/recovery events reset it.
        schedule(context, force = action != ROLLOVER && action != Intent.ACTION_DATE_CHANGED)
    }

    fun notificationsAllowed(context: Context): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled() && context.getSystemService(NotificationManager::class.java).getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE

    suspend fun deliver(context: Context, event: Intent) {
        val app = context.applicationContext as AgendaApplication
        val snapshot = app.repository.current()
        val config = snapshot.settings
        val today = LocalDate.now()
        if (!config.reminderEnabled || snapshot.syncedAt == null || event.getStringExtra("revision") != config.revision || event.getStringExtra("date") != today.toString() || event.getIntExtra("hour", -1) != config.hour || event.getIntExtra("minute", -1) != config.minute) return
        val entries = snapshot.upcoming(today)
        if (entries.isEmpty() || !notificationsAllowed(context)) return
        if (!app.settings.claimSummary("${config.revision}:$today")) return
        channel(context)
        val title = "今天未完成 ${entries.count { it.date == today }} 项，未来七天 ${entries.size} 项"
        val stamp = java.time.Instant.ofEpochMilli(snapshot.syncedAt).atZone(java.time.ZoneId.systemDefault()).format(java.time.format.DateTimeFormatter.ofPattern("MM-dd HH:mm"))
        val body = entries.take(6).joinToString("\n") { "${it.date.monthValue}/${it.date.dayOfMonth} · ${it.title}" } + "\n最后同步：$stamp" + if (config.needsLogin) "（授权待更新）" else ""
        val open = PendingIntent.getActivity(context, 31, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title).setContentText("点击查看七天清单 · 同步于 $stamp")
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(open).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build()
        try { NotificationManagerCompat.from(context).notify(9, notification) }
        catch (_: SecurityException) { /* Revoked POST_NOTIFICATIONS: next schedule still survives. */ }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        val app = context.applicationContext as AgendaApplication
        app.scope.launch(Dispatchers.IO) {
            try {
                withTimeout(8_000) {
                    if (intent.action == ReminderScheduler.DAILY) ReminderScheduler.deliver(context, intent)
                    ReminderScheduler.scheduleAfterEvent(context, intent.action)
                    AgendaWidget().updateAll(context)
                }
            } catch (error: Exception) {
                android.util.Log.e("AgendaReminder", "Reminder receiver could not finish", error)
            } finally { pending.finish() }
        }
    }
}
