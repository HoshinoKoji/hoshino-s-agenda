package club.hoshino.agenda.data

import android.content.Context
import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "projects")
data class ProjectRow(@PrimaryKey val id: String, val name: String, val color: String)

@Entity(tableName = "entries")
data class EntryRow(@PrimaryKey val id: String, val projectId: String, val date: String?, val title: String, val completed: Boolean, val createdAt: String)

@Entity(tableName = "snapshot")
data class SnapshotRow(@PrimaryKey val key: Int = 1, val email: String, val revision: String, val syncedAt: Long)

@Dao
interface AgendaDao {
    @Query("SELECT * FROM snapshot WHERE `key` = 1") fun observeSnapshot(): Flow<SnapshotRow?>
    @Query("SELECT * FROM entries") suspend fun entries(): List<EntryRow>
    @Query("SELECT * FROM projects") suspend fun projects(): List<ProjectRow>
    @Query("SELECT * FROM snapshot WHERE `key` = 1") suspend fun snapshot(): SnapshotRow?
    @Query("DELETE FROM entries") suspend fun clearEntries()
    @Query("DELETE FROM projects") suspend fun clearProjects()
    @Query("DELETE FROM snapshot") suspend fun clearSnapshot()
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertEntries(rows: List<EntryRow>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertProjects(rows: List<ProjectRow>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertSnapshot(row: SnapshotRow)
}

@Database(entities = [ProjectRow::class, EntryRow::class, SnapshotRow::class], version = 1)
abstract class AgendaDatabase : RoomDatabase() {
    abstract fun agenda(): AgendaDao
    companion object {
        fun create(context: Context): AgendaDatabase = Room.databaseBuilder(context, AgendaDatabase::class.java, "agenda.db").build()
    }
}
