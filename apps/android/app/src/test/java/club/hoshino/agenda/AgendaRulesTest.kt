package club.hoshino.agenda

import club.hoshino.agenda.data.*
import org.junit.Assert.*
import org.junit.Test
import java.time.*

class AgendaRulesTest {
    private val project = AgendaProject("project", "项目", "#8574D8")
    private fun entry(id: String, date: String?, completed: Boolean = false, created: String = "2026-01-01T00:00:00Z") = AgendaEntry(id, "project", date, id, completed, created)

    @Test fun sevenDaysIncludesTodayAndDaySixButNotOtherEntries() {
        val payload = AgendaPayload(listOf(project), listOf(
            entry("yesterday", "2026-12-28"), entry("today", "2026-12-29"), entry("last", "2027-01-04"),
            entry("outside", "2027-01-05"), entry("undated", null), entry("done", "2026-12-29", true),
        ))
        assertEquals(listOf("today", "last"), AgendaRules.upcoming(payload, LocalDate.parse("2026-12-29")).map { it.id })
    }

    @Test fun leapDayAndProjectDisplaySurviveTheWindow() {
        val payload = AgendaPayload(listOf(project), listOf(entry("leap", "2028-02-29"), entry("march", "2028-03-01")))
        val result = AgendaRules.upcoming(payload, LocalDate.parse("2028-02-27"))
        assertEquals(2, result.size)
        assertEquals("项目", result[0].project)
        assertEquals("#8574D8", result[0].color)
    }

    @Test fun sortUsesDateThenCreationThenStableId() {
        val payload = AgendaPayload(listOf(project), listOf(entry("z", "2026-10-04"), entry("a", "2026-10-04"), entry("early", "2026-10-04", created = "2025-01-01"), entry("later", "2026-10-05")))
        assertEquals(listOf("early", "a", "z", "later"), AgendaRules.upcoming(payload, LocalDate.parse("2026-10-04")).map { it.id })
    }

    @Test fun dailyReminderUsesLocalCalendarAcrossDstInsteadOfAdding24Hours() {
        val zone = ZoneId.of("America/New_York")
        val now = ZonedDateTime.of(2026, 3, 7, 10, 0, 0, 0, zone)
        val next = AgendaRules.nextReminder(now, LocalTime.of(9, 0))
        assertEquals(LocalDate.of(2026, 3, 8), next.toLocalDate())
        assertEquals(LocalTime.of(9, 0), next.toLocalTime())
        assertEquals(22, Duration.between(now, next).toHours())
    }

    @Test fun exactTimeAndMissedTimeScheduleTomorrow() {
        val zone = ZoneId.of("Asia/Shanghai")
        for (minute in listOf(0, 30)) {
            val now = ZonedDateTime.of(2026, 10, 4, 9, minute, 0, 0, zone)
            assertEquals(LocalDate.of(2026, 10, 5), AgendaRules.nextReminder(now, LocalTime.of(9, 0)).toLocalDate())
        }
        val before = ZonedDateTime.of(2026, 10, 4, 8, 59, 0, 0, zone)
        assertEquals(before.toLocalDate(), AgendaRules.nextReminder(before, LocalTime.of(9, 0)).toLocalDate())
    }

    @Test fun decodeDropsDescriptionEncryptionAndAssetContentFromLocalModel() {
        val payload = AgendaRules.decode("""{"projects":[{"id":"p","name":"项目","color":"#123456"}],"entries":[{"id":"e","projectId":"p","date":null,"title":"标题","completed":false,"createdAt":"2026-01-01","description":"private","encryptedDescription":{"ciphertext":"secret"},"assetIds":["asset"]}],"assets":[{"name":"private"}]}""")
        assertEquals("标题", payload.entries.single().title)
        assertFalse(payload.toString().contains("private"))
        assertFalse(payload.toString().contains("secret"))
    }

    @Test fun malformedDatesAndDuplicateIdsRejectTheEntireSnapshot() {
        val base = """{"projects":[{"id":"p","name":"项目","color":"#123456"}],"entries":[{"id":"e","projectId":"p","date":"DATE","title":"标题","completed":false,"createdAt":"2026"}]}"""
        for (date in listOf("2026-02-29", "0000-01-01", "2026-1-01")) assertThrows(Exception::class.java) { AgendaRules.decode(base.replace("DATE", date)) }
        assertThrows(Exception::class.java) { AgendaRules.decode(base.replace("DATE", "2026-01-01").replace("}],\"entries\"", "},{\"id\":\"p\",\"name\":\"duplicate\",\"color\":\"#123456\"}],\"entries\"")) }
    }
}
