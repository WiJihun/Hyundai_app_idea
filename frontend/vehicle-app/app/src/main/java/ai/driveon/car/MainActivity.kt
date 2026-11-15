package ai.driveon.car

import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.data.DestinationInfo
import ai.pleos.playground.navi.data.RouteInfo
import ai.pleos.playground.navi.data.RouteStartInfo
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * DriveOn 차량 앱 (Pleos Connect)
 *
 * - 화면: 지금까지 만든 DriveOn 차량 화면(웹, /car/)을 WebView로 그대로 띄운다.
 * - 데이터: Pleos NaviHelper SDK가 알려 주는 '집까지 남은 시간·거리'를 DriveOn 서버(POST /car/nav)로 보낸다.
 *   서버는 가상 주행 대신 이 실제 내비 값으로 도착 예정과 매장 전송 시각을 계산한다.
 *
 * 서버 주소: 에뮬레이터에서 PC의 localhost = 10.0.2.2
 */
class MainActivity : Activity() {

    private val tag = "DriveOn"
    private val server = "http://10.0.2.2:4173"
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private lateinit var navi: NaviHelper
    private lateinit var web: WebView
    private lateinit var badge: TextView
    private var routeRequested = false

    // 집: 정자동 (서버 world.ts의 HOME과 같은 자리)
    private val home = RouteInfo(
        latitude = 37.3655,
        longitude = 127.112,
        displayLatitude = null,
        displayLongitude = null,
        poiName = "집(정자동)",
        poiId = "",
        poiSubId = "0",
        address = "경기도 성남시 분당구 정자동",
    )

    /** 10초마다 내비에 남은 시간을 묻는다 (서버의 30초 ETA 보고보다 촘촘하게) */
    private val poll = object : Runnable {
        override fun run() {
            navi.getDestinationInfo()
            main.postDelayed(this, 10_000)
        }
    }

    private val listener = object : NaviHelperEventListener {
        override fun onRouteStarted(routeStartInfo: RouteStartInfo) {
            Log.d(tag, "경로 시작 $routeStartInfo")
        }
        override fun onRoutingCompleted() {
            navi.getDestinationInfo()
        }
        override fun onDestinationInfo(destinationInfo: DestinationInfo) {
            main.post { onEta(destinationInfo) }
        }
        override fun onError(errorCode: NaviErrorCode) {
            main.post { showBadge("내비 오류: $errorCode") }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#06090E"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()
            loadUrl("$server/car/")
        }
        badge = TextView(this).apply {
            textSize = 13f
            setTextColor(Color.parseColor("#7FDCF5"))
            setBackgroundColor(Color.parseColor("#CC06090E"))
            setPadding(16, 6, 16, 6)
        }
        setContentView(FrameLayout(this).apply {
            addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(badge, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, android.view.Gravity.BOTTOM or android.view.Gravity.START))
        })

        showBadge("📡 Pleos 내비 연결 중…")
        navi = NaviHelper(applicationContext)
        navi.initialize(
            onConnected = {
                main.post {
                    navi.addListener(listener)
                    navi.getDestinationInfo()
                    main.postDelayed(poll, 10_000)
                }
            },
            onFailed = { e -> main.post { showBadge("📡 내비 연결 실패: ${e.message}") } },
        )
    }

    /** 내비 남은 시간 → 서버로. 목적지가 없으면 집으로 안내를 시작한다. */
    private fun onEta(d: DestinationInfo) {
        if (d.remainTime <= 0 && d.remainDistance <= 0) {
            if (!routeRequested) {
                routeRequested = true
                showBadge("📡 집으로 경로 요청 중…")
                navi.requestRoute(home)
            }
            return
        }
        showBadge("📡 Pleos 내비 · ${d.name} ${d.remainTime / 60}분 · ${"%.1f".format(d.remainDistance / 1000.0)}km")
        val body = JSONObject()
            .put("remainSec", d.remainTime)
            .put("remainMeters", d.remainDistance)
            .put("name", d.name)
            .toString()
        io.execute { post("/car/nav", body) }
    }

    private fun post(path: String, json: String) {
        try {
            val c = URL(server + path).openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.connectTimeout = 3000
            c.readTimeout = 3000
            c.doOutput = true
            c.setRequestProperty("content-type", "application/json")
            c.outputStream.use { it.write(json.toByteArray()) }
            val code = c.responseCode
            c.disconnect()
            if (code !in 200..299) Log.w(tag, "$path → $code")
        } catch (e: Exception) {
            Log.w(tag, "$path 실패: $e")
            main.post { showBadge("⚠ 서버 연결 실패 ($server) — PC에서 npm start 확인") }
        }
    }

    private fun showBadge(text: String) {
        badge.text = text
        Log.d(tag, text)
    }

    override fun onDestroy() {
        main.removeCallbacks(poll)
        navi.removeListener(listener)
        navi.release()
        io.shutdown()
        web.destroy()
        super.onDestroy()
    }
}
