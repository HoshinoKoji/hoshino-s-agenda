package club.hoshino.agenda.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime

@Serializable
data class AgendaProject(val id: String, val name: String, val color: String)

@Serializable
data class AgendaEntry(
    val id: String,
    val projectId: String,
    val date: String?,
    val title: String,
    val completed: Boolean,
    val createdAt: String,
)

@Serializable
data class AgendaPayload(val projects: List<AgendaProject>, val entries: List<AgendaEntry>)

data class ListEntry(val id: String, val title: String, val date: LocalDate, val project: String, val color: String)

object AgendaRules {
    private val json = Json { ignoreUnknownKeys = true }
    private val idPattern = Regex("^[A-Za-z0-9_-]{1,64}$")

    fun decode(body: String): AgendaPayload {
        val payload = json.decodeFromString<AgendaPayload>(body)
        require(payload.projects.map { it.id }.distinct().size == payload.projects.size)
        require(payload.entries.map { it.id }.distinct().size == payload.entries.size)
        payload.projects.forEach { require(idPattern.matches(it.id) && Regex("^#[0-9a-fA-F]{6}$").matches(it.color)) }
        payload.entries.forEach {
            require(idPattern.matches(it.id) && idPattern.matches(it.projectId))
            it.date?.let { date ->
                require(Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$").matches(date))
                require(LocalDate.parse(date).year in 1..9999)
            }
        }
        return payload
    }

    fun upcoming(payload: AgendaPayload, today: LocalDate): List<ListEntry> {
        val projects = payload.projects.associateBy { it.id }
        return payload.entries.asSequence()
            .filter { !it.completed && it.date != null }
            .filter { val date = LocalDate.parse(it.date); !date.isBefore(today) && !date.isAfter(today.plusDays(6)) }
            .sortedWith(compareBy<AgendaEntry> { it.date }.thenBy { it.createdAt }.thenBy { it.id })
            .map { entry ->
                val project = projects[entry.projectId]
                ListEntry(entry.id, entry.title, LocalDate.parse(entry.date), project?.name ?: "未知项目", project?.color ?: "#8574D8")
            }.toList()
    }

    fun nextReminder(now: ZonedDateTime, time: LocalTime): ZonedDateTime {
        val candidate = now.toLocalDate().atTime(time).atZone(now.zone)
        return if (candidate.isAfter(now)) candidate else now.toLocalDate().plusDays(1).atTime(time).atZone(now.zone)
    }
}
