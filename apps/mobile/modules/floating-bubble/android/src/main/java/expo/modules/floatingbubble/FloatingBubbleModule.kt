package expo.modules.floatingbubble

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.abs

/**
 * Android "chat head" — a draggable overlay bubble drawn on top of every app
 * (SYSTEM_ALERT_WINDOW). Tapping it brings Tewiz back to the foreground.
 *
 * This is the Android complement to the iOS Live Activity: while a ride is
 * active and the captain leaves the app, the bubble keeps a one-tap way back in.
 *
 * The permission itself is already declared in the manifest by
 * plugins/withRideFullScreenIntent.js and granted via lib/overlayPermission.ts;
 * this module only draws the view. Every WindowManager call is marshalled onto
 * the main thread. All operations are guarded so a missing permission or a race
 * degrades to a no-op instead of crashing the JS bridge.
 */
class FloatingBubbleModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var bubbleView: View? = null
  private var titleText: TextView? = null
  private var subtitleText: TextView? = null

  private val appContextOrNull: Context?
    get() = appContext.reactContext

  override fun definition() = ModuleDefinition {
    Name("FloatingBubble")

    // Whether the user has granted "display over other apps". JS checks this
    // before calling show() and routes to lib/overlayPermission.ts otherwise.
    Function("canDrawOverlays") {
      val ctx = appContextOrNull ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) true
      else Settings.canDrawOverlays(ctx)
    }

    // Show (or update, if already visible) the bubble.
    Function("show") { title: String, subtitle: String ->
      main.post { showBubble(title, subtitle) }
    }

    Function("hide") {
      main.post { hideBubble() }
    }

    // Never leave an orphaned overlay if the JS engine is torn down.
    OnDestroy {
      main.post { hideBubble() }
    }
  }

  private fun dp(value: Float): Int {
    val ctx = appContextOrNull ?: return value.toInt()
    return TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP, value, ctx.resources.displayMetrics,
    ).toInt()
  }

  private fun windowManager(ctx: Context): WindowManager =
    ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager

  private fun showBubble(title: String, subtitle: String) {
    val ctx = appContextOrNull ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(ctx)) return

    // Already visible → just refresh the labels, no re-add (avoids flicker).
    if (bubbleView != null) {
      titleText?.text = title
      subtitleText?.text = subtitle
      return
    }

    val view = buildBubbleView(ctx, title, subtitle)

    val type =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      android.graphics.PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = dp(16f)
      y = dp(120f)
    }

    attachDragAndTap(ctx, view, params)

    try {
      windowManager(ctx).addView(view, params)
      bubbleView = view
    } catch (_: Throwable) {
      // Permission revoked mid-flight / window already gone — stay a no-op.
      bubbleView = null
    }
  }

  private fun hideBubble() {
    val ctx = appContextOrNull
    val view = bubbleView ?: return
    bubbleView = null
    titleText = null
    subtitleText = null
    if (ctx == null) return
    try {
      windowManager(ctx).removeView(view)
    } catch (_: Throwable) {
      // Already detached — ignore.
    }
  }

  private fun buildBubbleView(ctx: Context, title: String, subtitle: String): View {
    val container = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(14f), dp(10f), dp(14f), dp(10f))
      background = GradientDrawable().apply {
        cornerRadius = dp(18f).toFloat()
        // Espresso brand background with a subtle border, matching the app.
        setColor(Color.parseColor("#2A1A12"))
        setStroke(dp(1f), Color.parseColor("#E5604A"))
      }
      elevation = dp(8f).toFloat()
    }

    val titleView = TextView(ctx).apply {
      text = title
      setTextColor(Color.parseColor("#FBF3E7"))
      textSize = 13f
      setTypeface(typeface, android.graphics.Typeface.BOLD)
    }
    val subtitleView = TextView(ctx).apply {
      text = subtitle
      setTextColor(Color.parseColor("#E8C9A8"))
      textSize = 11f
    }

    container.addView(titleView)
    container.addView(subtitleView)
    titleText = titleView
    subtitleText = subtitleView
    return container
  }

  private fun attachDragAndTap(ctx: Context, view: View, params: WindowManager.LayoutParams) {
    var initialX = 0
    var initialY = 0
    var touchX = 0f
    var touchY = 0f
    var dragged = false
    val touchSlop = dp(8f)

    view.setOnTouchListener { _, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          initialX = params.x
          initialY = params.y
          touchX = event.rawX
          touchY = event.rawY
          dragged = false
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = (event.rawX - touchX).toInt()
          val dy = (event.rawY - touchY).toInt()
          if (abs(dx) > touchSlop || abs(dy) > touchSlop) dragged = true
          params.x = initialX + dx
          params.y = initialY + dy
          try {
            windowManager(ctx).updateViewLayout(view, params)
          } catch (_: Throwable) {}
          true
        }
        MotionEvent.ACTION_UP -> {
          // A tap (not a drag) reopens the app.
          if (!dragged) launchApp(ctx)
          true
        }
        else -> false
      }
    }
  }

  private fun launchApp(ctx: Context) {
    try {
      val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
      intent?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      if (intent != null) ctx.startActivity(intent)
    } catch (_: Throwable) {
      // Launch intent unavailable — nothing we can do from here.
    }
  }
}
