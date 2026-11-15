package ai.driveon.car

import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.data.DestinationInfo
import ai.pleos.playground.navi.data.DrivingInfo
import ai.pleos.playground.navi.data.RouteInfo
import ai.pleos.playground.navi.data.RouteStartInfo
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * DriveOn 첫 단계: Pleos NaviHelper SDK로 '집까지 남은 시간'을 받아
 * 도착 시각과 매장 전송 시각(도착 − 조리 − 배달)을 계산해 보여 준다.
 *
 * 웹 프로토타입의 server/src/car.ts(가상 차량 ETA)를 실제 내비 값으로 바꾸는 첫 걸음.
 */
class MainActivity : Activity() {

    private val tag = "DriveOn"
    private val main = Handler(Looper.getMainLooper())
    private lateinit var navi: NaviHelper

    // 시연 메뉴: 바삭마요치킨 정자점 고추마요치킨 (조리 20분 + 배달 10분)
    private val prepMin = 20
    private val deliveryMin = 10

    // 집: 정자동 (웹 프로토타입 world.ts의 HOME과 같은 자리)
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

    private lateinit var status: TextView
    private lateinit var eta: TextView
    private lateinit var send: TextView
    private lateinit var detail: TextView
    private lateinit var log: TextView
    private val hhmm = SimpleDateFormat("HH:mm", Locale.KOREA)

    private val poll = object : Runnable {
        override fun run() {
            if (::navi.isInitialized) navi.getDestinationInfo()
            main.postDelayed(this, 5_000)
        }
    }

    private val listener = object : NaviHelperEventListener {
        override fun onRouteStarted(routeStartInfo: RouteStartInfo) = ui { addLog("경로 탐색 시작: $routeStartInfo") }
        override fun onRoutingCompleted() = ui {
            addLog("경로 탐색 완료")
            navi.getDestinationInfo()
        }
        override fun onDestinationChanged() = ui { addLog("목적지 바뀜") }
        override fun onDestinationInfo(destinationInfo: DestinationInfo) = ui { showEta(destinationInfo) }
        override fun onDrivingInfo(drivingInfo: DrivingInfo) = ui { addLog("주행 정보: $drivingInfo") }
        override fun onError(errorCode: NaviErrorCode) = ui {
            addLog("오류: $errorCode")
            status.text = "내비 오류: $errorCode"
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())

        navi = NaviHelper(applicationContext)
        status.text = "내비 서비스에 연결하는 중…"
        navi.initialize(
            onConnected = {
                ui {
                    status.text = "✅ Pleos 내비 연결됨"
                    addLog("NaviHelper 연결됨")
                    navi.addListener(listener)
                    navi.getDestinationInfo()
                    main.post(poll)
                }
            },
            onFailed = { e ->
                ui {
                    status.text = "❌ 내비 연결 실패: ${e.message}"
                    addLog("연결 실패: $e")
                }
            },
        )
    }

    override fun onDestroy() {
        main.removeCallbacks(poll)
        if (::navi.isInitialized) {
            navi.removeListener(listener)
            navi.release()
        }
        super.onDestroy()
    }

    /** 남은 시간 → 도착 시각 → 매장 전송 시각 */
    private fun showEta(d: DestinationInfo) {
        addLog("목적지 정보: ${d.name} · 남은 거리 ${d.remainDistance} · 남은 시간 ${d.remainTime}")
        if (d.remainTime <= 0 && d.remainDistance <= 0) {
            eta.text = "목적지가 없어요"
            send.text = "‘집으로 안내’를 눌러 주세요"
            detail.text = ""
            return
        }
        // remainTime 단위는 초로 본다 (에뮬레이터 값으로 확인 필요)
        val arrive = Date(System.currentTimeMillis() + d.remainTime * 1000L)
        val sendAt = Date(arrive.time - (prepMin + deliveryMin) * 60_000L)
        val km = d.remainDistance / 1000.0
        eta.text = "🏠 ${hhmm.format(arrive)} 도착"
        send.text = "📤 ${hhmm.format(sendAt)} 매장 전송"
        detail.text = "${d.name} · 남은 ${"%.1f".format(km)} km · ${d.remainTime / 60}분\n" +
            "도착 ${hhmm.format(arrive)} − 👨‍🍳 ${prepMin}분 − 🛵 ${deliveryMin}분 = 📤 ${hhmm.format(sendAt)}"
    }

    private fun buildUi(): View {
        val navy = Color.parseColor("#1B2433")
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#06090E"))
            setPadding(48, 36, 48, 36)
        }
        fun text(size: Float, color: String = "#EEF2F8", bold: Boolean = false) = TextView(this).apply {
            textSize = size
            setTextColor(Color.parseColor(color))
            if (bold) typeface = Typeface.DEFAULT_BOLD
        }
        root.addView(text(28f, bold = true).apply { text = "DriveOn · Pleos 내비 연동 테스트" })
        status = text(20f, "#9BA7BB").also { root.addView(it) }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(navy)
            setPadding(40, 32, 40, 32)
        }
        eta = text(56f, bold = true).apply { text = "–" }
        send = text(48f, "#5CCBEC", bold = true).apply { text = "" }
        detail = text(20f, "#9BA7BB")
        card.addView(eta); card.addView(send); card.addView(detail)
        root.addView(card, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 24 })

        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.START }
        fun button(label: String, onClick: () -> Unit) = Button(this).apply {
            text = label
            textSize = 22f
            setOnClickListener { onClick() }
        }
        buttons.addView(button("🏠 집으로 안내") {
            addLog("requestRoute(집)")
            navi.requestRoute(home)
        })
        buttons.addView(button("🔄 남은 시간 다시 받기") { navi.getDestinationInfo() })
        buttons.addView(button("✕ 안내 취소") { navi.cancelRoute() })
        root.addView(buttons, LinearLayout.LayoutParams(-1, -2).apply { topMargin = 24 })

        log = text(16f, "#727E93")
        root.addView(ScrollView(this).apply { addView(log) }, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = 16 })
        return root
    }

    private fun addLog(line: String) {
        Log.d(tag, line)
        log.text = "${SimpleDateFormat("HH:mm:ss", Locale.KOREA).format(Date())}  $line\n${log.text}".take(4000)
    }

    private fun ui(block: () -> Unit) {
        main.post(block)
    }
}
