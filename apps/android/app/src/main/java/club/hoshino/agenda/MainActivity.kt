package club.hoshino.agenda

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import club.hoshino.agenda.auth.OAuthProtocol
import club.hoshino.agenda.data.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class MainActivity : ComponentActivity() {
    private val app get() = application as AgendaApplication
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT), navigationBarStyle = SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT))
        setContent {
            val snapshot by app.repository.snapshots.collectAsStateWithLifecycle(AgendaSnapshot(Settings(), AgendaPayload(emptyList(), emptyList()), null))
            val syncing by app.repository.syncing.collectAsStateWithLifecycle()
            var email by remember(snapshot.settings.email) { mutableStateOf(snapshot.settings.email) }
            var authorizing by remember { mutableStateOf(false) }
            MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF8574D8))) {
                Scaffold { padding ->
                    LazyColumn(Modifier.fillMaxSize().padding(padding).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        item { Text("日迹 · 未来七天", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 20.dp)) }
                        item {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedTextField(email, { email = it }, label = { Text("邮箱空间") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Button(onClick = {
                                        lifecycleScope.launch {
                                            authorizing = true
                                            try { app.repository.changeEmail(email); app.reconcile(); app.oauth.begin(this@MainActivity) }
                                            catch (error: Exception) {
                                                if (error is CancellationException) throw error
                                                app.settings.status(error.message ?: "登录失败")
                                            } finally { authorizing = false }
                                        }
                                    }, enabled = !authorizing && !syncing) { Text(if (authorizing) "准备登录…" else "Access 登录") }
                                    OutlinedButton(onClick = { refresh(email) }, enabled = !syncing && !authorizing && email.isNotBlank()) { Text(if (syncing) "同步中…" else "同步") }
                                }
                                Text("浏览器编辑时请使用相同邮箱空间。", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                        if (snapshot.settings.error.isNotEmpty()) item { Text(snapshot.settings.error, color = MaterialTheme.colorScheme.error) }
                        item {
                            val stamp = snapshot.syncedAt?.let { DateTimeFormatter.ofPattern("MM-dd HH:mm").format(Instant.ofEpochMilli(it).atZone(ZoneId.systemDefault())) } ?: "尚未同步"
                            Text("最后同步：$stamp", style = MaterialTheme.typography.bodySmall)
                        }
                        item { CompanionControls(app, snapshot.settings, syncing || authorizing) }
                        val upcoming = snapshot.upcoming()
                        if (upcoming.isEmpty()) item { Text(if (snapshot.syncedAt == null) "登录并同步后显示清单。" else "未来七天没有未完成事项。") }
                        upcoming.groupBy { it.date }.forEach { (date, entries) ->
                            item(key = "date-$date") { Text(DateTimeFormatter.ofPattern("M月d日 E", java.util.Locale.CHINA).format(date), style = MaterialTheme.typography.titleMedium) }
                            items(entries, key = { it.id }) { entry ->
                                Card(Modifier.fillMaxWidth().clickable { openEntry(entry.id) }) {
                                    Column(Modifier.padding(16.dp)) {
                                        Text(entry.title, style = MaterialTheme.typography.bodyLarge)
                                        Text(entry.project, color = Color(android.graphics.Color.parseColor(entry.color)), style = MaterialTheme.typography.bodySmall)
                                    }
                                }
                            }
                        }
                        item { Spacer(Modifier.height(20.dp)) }
                    }
                }
            }
        }
    }

    private fun refresh(email: String? = null, automatic: Boolean = false) {
        lifecycleScope.launch {
            try {
                email?.let { app.repository.changeEmail(it) }
                if (automatic) app.automaticSync() else app.sync()
            }
            catch (error: CancellationException) { throw error }
            catch (_: Exception) { /* Repository exposes the sync error without replacing cached data. */ }
        }
    }

    override fun onResume() { super.onResume(); refresh(automatic = true) }
    private fun openEntry(id: String) {
        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("${OAuthProtocol.ORIGIN}/?editEntry=${Uri.encode(id)}"))) }
        catch (_: android.content.ActivityNotFoundException) { lifecycleScope.launch { app.settings.status("未找到可打开 HTTPS 链接的浏览器") } }
    }
}
