package club.hoshino.agenda.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.*
import androidx.glance.action.*
import androidx.glance.appwidget.*
import androidx.glance.appwidget.action.*
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.layout.*
import androidx.glance.text.*
import androidx.glance.unit.ColorProvider
import club.hoshino.agenda.AgendaApplication
import club.hoshino.agenda.MainActivity
import club.hoshino.agenda.auth.OAuthProtocol
import club.hoshino.agenda.background.SyncJobs
import club.hoshino.agenda.data.AgendaSnapshot
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class AgendaWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(DpSize(180.dp, 140.dp), DpSize(280.dp, 280.dp), DpSize(320.dp, 420.dp)))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val app = context.applicationContext as AgendaApplication
        val initial = app.repository.current()
        provideContent {
            val snapshot by app.repository.snapshots.collectAsState(initial)
            Content(snapshot)
        }
    }

    @Composable private fun Content(snapshot: AgendaSnapshot) {
        val today = LocalDate.now()
        val entries = snapshot.upcoming(today)
        Column(GlanceModifier.fillMaxSize().background(Color(0xFFF8F6FC)).padding(12.dp).appWidgetBackground()) {
            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
                Text("未来七天 · ${entries.size}", GlanceModifier.defaultWeight().clickable(actionStartActivity<MainActivity>()), style = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Bold, color = ColorProvider(Color(0xFF51447C))))
                Text("刷新", GlanceModifier.padding(8.dp).clickable(actionRunCallback<RefreshWidget>()), style = TextStyle(fontSize = 12.sp, color = ColorProvider(Color(0xFF51447C))))
            }
            val stamp = snapshot.syncedAt?.let { DateTimeFormatter.ofPattern("MM-dd HH:mm").format(Instant.ofEpochMilli(it).atZone(ZoneId.systemDefault())) } ?: "尚未同步"
            Text("${today.monthValue}/${today.dayOfMonth} 起 · 同步 $stamp", style = TextStyle(fontSize = 11.sp, color = ColorProvider(Color(0xFF686373))))
            if (snapshot.settings.error.isNotEmpty()) {
                Text(if (snapshot.settings.needsLogin) "授权待更新，点击打开 App" else "同步失败，当前显示缓存", GlanceModifier.clickable(actionStartActivity<MainActivity>()), style = TextStyle(fontSize = 11.sp, color = ColorProvider(Color(0xFFAB394B))))
            }
            Spacer(GlanceModifier.height(6.dp))
            if (entries.isEmpty()) {
                Text(if (snapshot.syncedAt == null) "打开 App 登录并同步" else "七天内没有未完成事项", GlanceModifier.fillMaxWidth().clickable(actionStartActivity<MainActivity>()), style = TextStyle(fontSize = 13.sp))
            } else {
                LazyColumn(GlanceModifier.fillMaxSize()) {
                    entries.groupBy { it.date }.forEach { (date, group) ->
                        item { Text("${date.monthValue}/${date.dayOfMonth}${if (date == today) " · 今天" else ""} · ${group.size} 项", GlanceModifier.padding(vertical = 5.dp), style = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Bold, color = ColorProvider(Color(0xFF292431)))) }
                        items(group) { entry ->
                            val open = Intent(Intent.ACTION_VIEW, Uri.parse("${OAuthProtocol.ORIGIN}/?editEntry=${Uri.encode(entry.id)}"))
                            Column(GlanceModifier.fillMaxWidth().padding(vertical = 5.dp).clickable(actionStartActivity(open))) {
                                Text(entry.title, style = TextStyle(fontSize = 14.sp, color = ColorProvider(Color(0xFF292431))), maxLines = 2)
                                Text("● ${entry.project}", style = TextStyle(fontSize = 11.sp, color = ColorProvider(Color(android.graphics.Color.parseColor(entry.color)))), maxLines = 1)
                            }
                        }
                    }
                }
            }
        }
    }
}

class AgendaWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget = AgendaWidget() }

class RefreshWidget : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        SyncJobs.refresh(context)
        AgendaWidget().updateAll(context)
    }
}
