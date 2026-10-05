package club.hoshino.agenda

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import androidx.room.withTransaction
import androidx.test.core.app.ApplicationProvider
import club.hoshino.agenda.background.ReminderScheduler
import club.hoshino.agenda.data.*
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.cancel
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], application = AgendaApplication::class)
class AndroidIntegrationTest {
    private val app: AgendaApplication get() = ApplicationProvider.getApplicationContext()
    @After fun closeDatabase() { app.scope.cancel(); app.database.close() }
    private fun <T> androidTest(block: suspend () -> T): T = runBlocking { withTimeout(15_000) { block() } }

    private suspend fun seed(): Settings {
        app.repository.changeEmail("owner@example.com")
        val config = app.settings.current()
        app.database.withTransaction {
            app.database.agenda().insertProjects(listOf(ProjectRow("project", "项目", "#8574D8")))
            app.database.agenda().insertEntries(listOf(EntryRow("entry", "project", LocalDate.now().toString(), "今日事项", false, "2026-01-01")))
            app.database.agenda().insertSnapshot(SnapshotRow(email = config.email, revision = config.revision, syncedAt = System.currentTimeMillis()))
        }
        return config
    }

    @Test fun applicationAndComposeActivityStartOnAndroid16() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        assertNotNull(controller.get())
        assertNotNull(app.getSystemService(NotificationManager::class.java).getNotificationChannel("daily-summary"))
        controller.pause().stop().destroy()
    }

    @Test fun spaceChangeClearsTheAtomicRoomSnapshot() = androidTest {
        seed()
        assertEquals(1, app.repository.current().upcoming().size)
        app.repository.changeEmail("other@example.com")
        val current = app.repository.current()
        assertNull(current.syncedAt)
        assertTrue(current.upcoming().isEmpty())
        assertTrue(app.database.agenda().entries().isEmpty())
        assertFalse(app.settings.claimSummary("stale-revision:${LocalDate.now()}"))
    }

    @Test fun dailySchedulePersistsAndTurningItOffCancelsTheReminder() = androidTest {
        seed()
        ReminderScheduler.schedule(app, force = true)
        val alarms = shadowOf(app.getSystemService(AlarmManager::class.java))
        assertEquals(2, alarms.scheduledAlarms.size)
        val stored = app.settings.scheduled()
        assertTrue(stored.first.isNotBlank())
        assertTrue(stored.second > System.currentTimeMillis())
        ReminderScheduler.schedule(app)
        assertEquals(stored, app.settings.scheduled())
        app.settings.reminder(9, 0, false)
        ReminderScheduler.schedule(app)
        assertEquals(1, alarms.scheduledAlarms.size) // Day rollover still updates the widget.
        assertEquals("", app.settings.scheduled().first)
    }

    @Test fun staleAlarmsAreIgnoredAndTheSameDayIsNotNotifiedTwice() = androidTest {
        val config = seed()
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val manager = shadowOf(app.getSystemService(NotificationManager::class.java))
        val event = Intent(ReminderScheduler.DAILY).putExtra("date", LocalDate.now().toString()).putExtra("hour", 9).putExtra("minute", 0)
        ReminderScheduler.deliver(app, event.putExtra("revision", "stale"))
        assertTrue(manager.allNotifications.isEmpty())
        ReminderScheduler.deliver(app, event.putExtra("revision", config.revision))
        val first = manager.getNotification(9)
        assertNotNull(first)
        ReminderScheduler.deliver(app, event)
        assertSame(first, manager.getNotification(9))
    }

    @Test fun syncDoesNotCancelAnInexactAlarmAlreadyDueToday() = androidTest {
        seed()
        ReminderScheduler.schedule(app, force = true)
        val manager = app.getSystemService(AlarmManager::class.java)
        val signature = app.settings.scheduled().first
        val overdue = LocalDate.now().atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()
        val operation = PendingIntent.getBroadcast(app, 21, Intent(app, club.hoshino.agenda.background.ReminderReceiver::class.java).setAction(ReminderScheduler.DAILY), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, overdue, operation)
        app.settings.scheduled(signature, overdue)
        ReminderScheduler.schedule(app)
        assertEquals(overdue, app.settings.scheduled().second)
        assertTrue(shadowOf(manager).scheduledAlarms.any { it.triggerAtTime == overdue })
        ReminderScheduler.scheduleAfterEvent(app, ReminderScheduler.ROLLOVER)
        ReminderScheduler.scheduleAfterEvent(app, Intent.ACTION_DATE_CHANGED)
        assertEquals(overdue, app.settings.scheduled().second)
    }

    @Test fun foregroundWithoutAGrantKeepsTheDetailedLoginFailure() = androidTest {
        app.repository.changeEmail("owner@example.com")
        val message = "注册登录客户端失败：HTTP 400，invalid_redirect_uri"
        app.settings.status(message, true)
        app.automaticSync()
        assertEquals(message, app.settings.current().error)
        assertTrue(app.settings.current().needsLogin)
    }
}
