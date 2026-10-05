package club.hoshino.agenda.data

import androidx.room.withTransaction
import club.hoshino.agenda.auth.OAuthManager
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.LocalDate

data class AgendaSnapshot(val settings: Settings, val payload: AgendaPayload, val syncedAt: Long?) {
    fun upcoming(today: LocalDate = LocalDate.now()) = AgendaRules.upcoming(payload, today)
}

class AgendaRepository(private val db: AgendaDatabase, private val settings: AgendaSettings, private val oauth: OAuthManager, private val http: AgendaHttp) {
    private val dao = db.agenda()
    private val accountMutex = Mutex()
    private val syncMutex = Mutex()
    val syncing = MutableStateFlow(false)
    // The marker is written in the same transaction as all rows. Read the complete snapshot
    // transactionally on invalidation, rather than combining independently refreshed tables.
    val snapshots: Flow<AgendaSnapshot> = combine(settings.flow, dao.observeSnapshot()) { _, _ -> Unit }
        .conflate().map { current() }.distinctUntilChanged().flowOn(Dispatchers.IO)

    private fun snapshot(config: Settings, projects: List<ProjectRow>, entries: List<EntryRow>, marker: SnapshotRow?): AgendaSnapshot {
        val matches = marker?.email == config.email && marker.revision == config.revision
        return AgendaSnapshot(config, if (matches) AgendaPayload(projects.map { AgendaProject(it.id, it.name, it.color) }, entries.map { AgendaEntry(it.id, it.projectId, it.date, it.title, it.completed, it.createdAt) }) else AgendaPayload(emptyList(), emptyList()), if (matches) marker?.syncedAt else null)
    }

    suspend fun current(): AgendaSnapshot = withContext(Dispatchers.IO) {
        accountMutex.withLock {
            val config = settings.current()
            db.withTransaction { snapshot(config, dao.projects(), dao.entries(), dao.snapshot()) }
        }
    }

    suspend fun changeEmail(value: String) = accountMutex.withLock {
        val old = settings.current()
        settings.setEmail(value)
        if (old.revision != settings.current().revision) db.withTransaction { dao.clearEntries(); dao.clearProjects(); dao.clearSnapshot() }
    }

    suspend fun disconnect() {
        // Wait for any in-flight sync before clearing its credentials and snapshot.
        syncMutex.withLock {
            accountMutex.withLock {
                oauth.disconnect()
                db.withTransaction { dao.clearEntries(); dao.clearProjects(); dao.clearSnapshot() }
                settings.status("已断开授权，请重新登录", true)
            }
        }
    }

    suspend fun sync() = syncMutex.withLock {
        val config = settings.current()
        if (config.email.isBlank()) return@withLock
        syncing.value = true
        try {
            val payload = withContext(Dispatchers.IO) {
                val token = oauth.token()
                try { http.agenda(token, config.email) }
                catch (_: LoginRequired) { http.agenda(oauth.token(forceRefresh = true), config.email) }
            }
            accountMutex.withLock {
                if (settings.current().revision != config.revision) return@withLock
                db.withTransaction {
                    dao.clearEntries(); dao.clearProjects()
                    dao.insertProjects(payload.projects.map { ProjectRow(it.id, it.name, it.color) })
                    dao.insertEntries(payload.entries.map { EntryRow(it.id, it.projectId, it.date, it.title, it.completed, it.createdAt) })
                    dao.insertSnapshot(SnapshotRow(email = config.email, revision = config.revision, syncedAt = System.currentTimeMillis()))
                }
                settings.status("")
            }
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) {
            accountMutex.withLock {
                if (settings.current().revision == config.revision) settings.status(
                    if (error is java.io.IOException) error.message ?: "同步失败，请检查网络" else "云端数据无法读取，请重试",
                    error is LoginRequired,
                )
            }
            throw error
        } finally { syncing.value = false }
    }
}
