package com.kugou.player

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * 播放保活前台服务。
 *
 * 只负责把进程钉在前台并挂一条常驻通知，真正的音频播放仍由 WebView 里的 <audio> 完成。
 * 由 MainActivity 在「切后台且前端报告正在播放」时拉起，回到前台即停止。
 */
class MediaPlaybackService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    ensureChannel()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    // 被系统回收后重建，前端回到前台会重新判断是否还需要保活。
    return START_STICKY
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "播放中", NotificationManager.IMPORTANCE_LOW)
    channel.description = "后台播放时常驻的通知"
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    // 通知文案保持通用，真实曲目信息不在这里拼装。
    val contentIntent = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    // minSdk 24：API 26 以下只有一个参数的 Channel 概念，channel id 会被忽略。
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
    return builder
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle("正在后台播放")
      .setContentText("点按返回播放器")
      .setOngoing(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(contentIntent)
      .build()
  }

  companion object {
    private const val CHANNEL_ID = "kugou_playback"
    private const val NOTIFICATION_ID = 1001

    fun start(context: Context) {
      val intent = Intent(context, MediaPlaybackService::class.java)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (e: Exception) {
        // Android 12+ 后台受限时会抛 ForegroundServiceStartNotAllowedException，
        // 启动失败只是没有常驻通知，不影响播放本身。
        android.util.Log.w("MediaPlaybackService", "无法启动前台服务: ${e.message}")
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, MediaPlaybackService::class.java))
    }
  }
}
