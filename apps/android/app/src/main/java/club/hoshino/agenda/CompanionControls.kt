package club.hoshino.agenda

import android.Manifest
import android.appwidget.AppWidgetManager
import android.app.TimePickerDialog
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import club.hoshino.agenda.background.ReminderScheduler
import club.hoshino.agenda.background.SyncJobs
import club.hoshino.agenda.data.Settings as AgendaConfig
import club.hoshino.agenda.widget.AgendaWidgetReceiver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
fun CompanionControls(app: AgendaApplication, config: AgendaConfig, busy: Boolean) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val owner = LocalLifecycleOwner.current
    var permissionVersion by remember { mutableIntStateOf(0) }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { permissionVersion++ }
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) permissionVersion++ }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    val notifications = remember(permissionVersion) { ReminderScheduler.notificationsAllowed(context) }
    val exact = remember(permissionVersion) { ReminderScheduler.exactAllowed(context) }
    fun update(block: suspend () -> Unit) {
        scope.launch {
            try { block(); app.reconcile() }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { app.settings.status(error.message ?: "设置更新失败") }
        }
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("每日汇总 · %02d:%02d".format(config.hour, config.minute), style = MaterialTheme.typography.titleMedium)
                Switch(config.reminderEnabled, { enabled -> update { app.settings.reminder(config.hour, config.minute, enabled) } }, enabled = !busy)
            }
            Text("今天与未来七天的未完成事项；七天内为空时不通知。", style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = {
                TimePickerDialog(context, { _, hour, minute -> update { app.settings.reminder(hour, minute, config.reminderEnabled) } }, config.hour, config.minute, true).show()
            }, enabled = !busy) { Text("修改提醒时间") }
            Text("通知：${if (notifications) "已允许" else "未允许"} · 精确提醒：${if (exact) "已允许" else "未允许，可能延后"}", style = MaterialTheme.typography.bodySmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {
                    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    else openSettings(context, Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
                }) { Text("通知设置") }
                if (Build.VERSION.SDK_INT >= 31) OutlinedButton(onClick = { openSettings(context, Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))) }) { Text("精确提醒") }
                if (Build.VERSION.SDK_INT >= 31) OutlinedButton(onClick = { openSettings(context, Intent(Settings.ACTION_APP_OPEN_BY_DEFAULT_SETTINGS, Uri.parse("package:${context.packageName}"))) }) { Text("回跳设置") }
                OutlinedButton(onClick = {
                    val manager = context.getSystemService(AppWidgetManager::class.java)
                    if (manager.isRequestPinAppWidgetSupported) manager.requestPinAppWidget(ComponentName(context, AgendaWidgetReceiver::class.java), null, null)
                    else update { app.settings.status("请在桌面长按空白区域，添加「日迹 · 未来七天」组件") }
                }) { Text("添加桌面组件") }
            }
            Text("登录未自动回到 App 时，在浏览器回跳页点击「返回日迹 App」。Firefox 可在设置中将「在应用中打开链接」设为询问或始终。", style = MaterialTheme.typography.bodySmall)
            Text("HyperOS：建议允许自启动，并将此应用的省电策略设为「无限制」。后台同步由系统安排，组件显示最后同步时间。", style = MaterialTheme.typography.bodySmall)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = {
                    val miui = Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"))
                    openSettings(context, miui)
                }) { Text("自启动设置") }
                TextButton(onClick = { openSettings(context, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))) }) { Text("应用与省电设置") }
                TextButton(onClick = { update { SyncJobs.cancel(context); app.repository.disconnect() } }, enabled = !busy) { Text("断开本机授权") }
            }
        }
    }
}

private fun openSettings(context: Context, intent: Intent) {
    try { context.startActivity(intent) }
    catch (_: Exception) {
        runCatching { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))) }
    }
}
