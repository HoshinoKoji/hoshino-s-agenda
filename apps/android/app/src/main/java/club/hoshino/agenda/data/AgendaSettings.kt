package club.hoshino.agenda.data

import android.content.Context
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.util.UUID

private val Context.agendaSettings by preferencesDataStore("agenda-settings")

data class Settings(
    val email: String = "",
    val revision: String = "",
    val hour: Int = 9,
    val minute: Int = 0,
    val reminderEnabled: Boolean = true,
    val error: String = "",
    val needsLogin: Boolean = false,
)

class AgendaSettings(context: Context) {
    private val store = context.agendaSettings
    private val email = stringPreferencesKey("email")
    private val revision = stringPreferencesKey("revision")
    private val hour = intPreferencesKey("hour")
    private val minute = intPreferencesKey("minute")
    private val enabled = booleanPreferencesKey("reminder-enabled")
    private val error = stringPreferencesKey("sync-error")
    private val needsLogin = booleanPreferencesKey("needs-login")
    private val delivered = stringPreferencesKey("delivered-summary")
    private val alarmAt = longPreferencesKey("next-alarm-at")
    private val alarmSignature = stringPreferencesKey("alarm-signature")
    val flow = store.data.map { Settings(it[email] ?: "", it[revision] ?: "", it[hour] ?: 9, it[minute] ?: 0, it[enabled] ?: true, it[error] ?: "", it[needsLogin] ?: false) }
    suspend fun current() = flow.first()

    suspend fun setEmail(value: String) {
        val normalized = value.trim().lowercase(java.util.Locale.ROOT)
        require(normalized.length <= 254 && Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(normalized)) { "请输入有效的邮箱空间" }
        store.edit {
            if (it[email] != normalized) { it[email] = normalized; it[revision] = UUID.randomUUID().toString(); it.remove(delivered); it.remove(error) }
        }
    }

    suspend fun reminder(timeHour: Int, timeMinute: Int, active: Boolean) {
        require(timeHour in 0..23 && timeMinute in 0..59)
        store.edit { it[hour] = timeHour; it[minute] = timeMinute; it[enabled] = active }
    }

    suspend fun status(message: String, login: Boolean = false) { store.edit { it[error] = message; it[needsLogin] = login } }

    suspend fun claimSummary(key: String): Boolean {
        var claimed = false
        store.edit { if (it[revision] == key.substringBefore(':') && it[enabled] != false && it[delivered] != key) { it[delivered] = key; claimed = true } }
        return claimed
    }

    suspend fun scheduled(): Pair<String, Long> = store.data.first().let { (it[alarmSignature] ?: "") to (it[alarmAt] ?: 0L) }
    suspend fun scheduled(signature: String, at: Long) { store.edit { it[alarmSignature] = signature; it[alarmAt] = at } }
}
