package com.kugou.player

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    registerBackNavigation()
    requestNotificationPermission()
  }

  /** WryActivity 里的 webView 是 private，只能通过这个钩子拿到引用。 */
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.webView = webView
  }

  override fun onStart() {
    super.onStart()
    // 回到前台就不再需要前台服务保活。
    MediaPlaybackService.stop(this)
  }

  override fun onStop() {
    // 先问前端是否在播放，再调 super（super 会通知 Rust 侧进入后台）。
    webView?.evaluateJavascript("window.__kugouPlaying === true") { result ->
      if (result == "true") {
        MediaPlaybackService.start(this)
      }
    }
    super.onStop()
  }

  /**
   * TauriActivity 里 handleBackNavigation = false，默认返回键会直接结束 Activity 并停掉播放。
   * 这里先派发 DOM 事件 'app-back' 让前端关掉弹层；前端没有消费（window.__kugouBackHandled 不为
   * true）时才真正退出。
   */
  private fun registerBackNavigation() {
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val view = webView
        if (view == null) {
          finish()
          return
        }
        view.evaluateJavascript("window.dispatchEvent(new Event('app-back'))", null)
        view.evaluateJavascript("window.__kugouBackHandled === true") { result ->
          if (result == "true") return@evaluateJavascript
          isEnabled = false
          onBackPressedDispatcher.onBackPressed()
          isEnabled = true
        }
      }
    })
  }

  /** Android 13+ 的通知权限，被拒绝也不影响播放，只是没有常驻通知。 */
  private fun requestNotificationPermission() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val granted = ContextCompat.checkSelfPermission(
      this,
      Manifest.permission.POST_NOTIFICATIONS
    ) == PackageManager.PERMISSION_GRANTED
    if (granted) return
    ActivityCompat.requestPermissions(
      this,
      arrayOf(Manifest.permission.POST_NOTIFICATIONS),
      NOTIFICATION_PERMISSION_REQUEST
    )
  }

  private companion object {
    const val NOTIFICATION_PERMISSION_REQUEST = 1001
  }
}
