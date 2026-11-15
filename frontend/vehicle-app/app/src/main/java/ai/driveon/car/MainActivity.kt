package ai.driveon.car

import ai.pleos.playground.navi.constants.NaviErrorCode
import ai.pleos.playground.navi.constants.WaypointIndex
import ai.pleos.playground.navi.data.CurrentLocationInfo
import ai.pleos.playground.navi.data.DestinationArrivedInfo
import ai.pleos.playground.navi.data.DestinationInfo
import ai.pleos.playground.navi.data.DrivingInfo
import ai.pleos.playground.navi.data.NavigationScreenRequest
import ai.pleos.playground.navi.data.RequestWaypointInfo
import ai.pleos.playground.navi.data.RouteInfo
import ai.pleos.playground.navi.data.RouteStartInfo
import ai.pleos.playground.navi.data.TBTInfo
import ai.pleos.playground.navi.data.WaypointArrivedInfo
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import ai.pleos.playground.stt.SpeechToText
import ai.pleos.playground.stt.listener.ResultListener
import ai.pleos.playground.tts.TextToSpeech
import ai.pleos.playground.tts.listener.EventListener
import android.annotation.SuppressLint
import android.app.Activity
import android.car.Car
import android.car.VehicleGear
import android.car.VehiclePropertyIds
import android.car.drivingstate.CarUxRestrictions
import android.car.drivingstate.CarUxRestrictionsManager
import android.car.hardware.CarPropertyValue
import android.car.hardware.property.CarPropertyManager
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors
import ai.pleos.playground.stt.constant.ErrorType as SttError
import ai.pleos.playground.stt.constant.Mode as SttMode
import ai.pleos.playground.stt.listener.OnInitializeListener as SttInit
import ai.pleos.playground.stt.listener.OnServerConnectionListener as SttServer
import ai.pleos.playground.tts.constant.ErrorType as TtsError
import ai.pleos.playground.tts.constant.Mode as TtsMode
import ai.pleos.playground.tts.listener.OnInitializeListener as TtsInit
import ai.pleos.playground.tts.listener.OnServerConnectionListener as TtsServer

/**
 * DriveOn 차량 앱 (Pleos Connect)
 *
 * 화면은 DriveOn 차량 화면(웹, /car/)을 WebView로 띄우고, 차량 기능은 모두 Pleos·Android Automotive SDK로 잇는다.
 *
 * | 무엇 | SDK | 서버로 |
 * |---|---|---|
 * | 집·경유지까지 남은 시간·거리, 현재 위치, 다음 갈림길(TBT) | NaviHelper | POST /car/nav |
 * | 포장 매장 경유지 추가·삭제, 내비 화면 열기 | NaviHelper | (화면 → 앱) |
 * | 경유지·목적지 도착 | NaviHelper 이벤트 | POST /car/event |
 * | 음성 인식(마이크) · 안내 음성 | Pleos SpeechToText · TextToSpeech | /gleo/utterance (화면이 보냄) |
 * | 주행 중 화면 제한 · 차속 · 기어 | Android Automotive (CarUxRestrictions, CarPropertyManager) | POST /car/vehicle |
 *
 * Pleos 서버 음성 인식을 쓰려면 local.properties에 pleos.clientId / pleos.clientSecret (Pleos Playground My Project)를 넣는다.
 * 없으면 차량 안 온디바이스 엔진(ON_DEVICE)으로 동작한다. 서버 주소: 에뮬레이터에서 PC = 10.0.2.2
 */
class MainActivity : Activity() {

    private val tag = "DriveOn"
    private val server = "http://10.0.2.2:4173"
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()

    private lateinit var web: WebView
    private lateinit var badge: TextView
    private lateinit var navi: NaviHelper
    private var stt: SpeechToText? = null
    private var tts: TextToSpeech? = null
    private var car: Car? = null

    private val hasKey = BuildConfig.PLEOS_CLIENT_ID.isNotBlank() && BuildConfig.PLEOS_CLIENT_SECRET.isNotBlank()

    // 최신 내비 값 (보고할 때 한 번에 묶어 보낸다)
    private var dest: DestinationInfo? = null
    private var wpSec: Int? = null
    private var wpMeters: Int? = null
    private var loc: CurrentLocationInfo? = null
    private var tbt: TBTInfo? = null
    private var routeRequested = false
    private var waypointSet = false

    // 최신 차량 상태
    private var restricted = false
    private var speedKmh = 0f
    private var gear: String? = null

    // 집: 정자동 (서버 world.ts의 HOME과 같은 자리)
    private val home = RouteInfo(
        latitude = 37.3655, longitude = 127.112, displayLatitude = null, displayLongitude = null,
        poiName = "집(정자동)", poiId = "", poiSubId = "0", address = "경기도 성남시 분당구 정자동",
    )

    // ───────── NaviHelper ─────────
    private val poll = object : Runnable {
        override fun run() {
            navi.getDestinationInfo()
            navi.getCurrentLocationInfo()
            navi.getTBTInfo()
            // 서버가 다시 켜져도 차량 상태를 알 수 있게 주기적으로 다시 보낸다
            lastVehicle = ""
            reportVehicle()
            main.postDelayed(this, 5_000)
        }
    }

    private val naviListener = object : NaviHelperEventListener {
        override fun onRouteStarted(routeStartInfo: RouteStartInfo) = log("경로 시작 $routeStartInfo")
        override fun onRoutingCompleted() = navi.getDestinationInfo()
        override fun onDestinationInfo(destinationInfo: DestinationInfo) = main.post { onDestination(destinationInfo) }.let { }
        override fun onDrivingInfo(drivingInfo: DrivingInfo) = main.post {
            // 첫 경유지(포장 매장)까지 남은 시간·거리
            val w = drivingInfo.waypoints.firstOrNull()
            wpSec = w?.duration
            wpMeters = w?.distance
        }.let { }
        override fun onCurrentLocationInfo(currentLocationInfo: CurrentLocationInfo) = main.post { loc = currentLocationInfo }.let { }
        override fun onTBTInfo(tbtInfo: List<TBTInfo>) = main.post { tbt = tbtInfo.firstOrNull() }.let { }
        override fun onWayPointArrived(waypointArrivedInfo: WaypointArrivedInfo) {
            log("경유지 도착 ${waypointArrivedInfo.name}")
            waypointSet = false
            send("/car/event", JSONObject().put("type", "waypointArrived"))
        }
        override fun onDestinationArrived(destinationArrivedInfo: DestinationArrivedInfo) {
            log("목적지 도착 ${destinationArrivedInfo.name}")
            send("/car/event", JSONObject().put("type", "destinationArrived"))
        }
        override fun onError(errorCode: NaviErrorCode) = main.post { showBadge("내비 오류: $errorCode") }.let { }
    }

    private fun onDestination(d: DestinationInfo) {
        log("목적지 정보: ${d.name} · ${d.remainDistance}m · ${d.remainTime}s")
        dest = d
        if (d.remainTime <= 0 && d.remainDistance <= 0) {
            if (!routeRequested) {
                routeRequested = true
                showBadge("📡 집으로 경로 요청 중…")
                navi.requestRoute(home)
            }
            return
        }
        reportNav()
    }

    /** 내비 값을 한 번에 서버로 */
    private fun reportNav() {
        val d = dest ?: return
        val body = JSONObject()
            .put("remainSec", d.remainTime)
            .put("remainMeters", d.remainDistance)
            .put("name", d.name)
        if (waypointSet && wpSec != null) body.put("waypointSec", wpSec).put("waypointMeters", wpMeters)
        loc?.let { body.put("pos", JSONObject().put("lat", it.latitude).put("lng", it.longitude).put("heading", it.heading)).put("address", it.address) }
        tbt?.let { body.put("tbt", JSONObject().put("type", it.type.name).put("distance", it.distance).put("description", it.description)) }
        send("/car/nav", body)
        showBadge("📡 Pleos 내비 · ${d.name} ${d.remainTime / 60}분 · ${"%.1f".format(d.remainDistance / 1000.0)}km" +
            (if (waypointSet && wpSec != null) " · 경유 ${wpSec!! / 60}분" else "") +
            " · 🎙️ ${if (hasKey) "Pleos 서버+온디바이스" else "온디바이스"} 음성")
    }

    // ───────── 화면(WebView) ↔ 차량 SDK ─────────
    /** 차량 화면(car.js)이 window.DriveOnNative로 부른다 */
    inner class Bridge {
        @JavascriptInterface fun listen() = main.post { startListening() }.let { }
        @JavascriptInterface fun stopListening() = main.post { stt?.stop() }.let { }
        @JavascriptInterface fun speak(text: String) = main.post { tts?.speak(text, true) ?: log("TTS 준비 전: $text") }.let { }
        @JavascriptInterface fun stopSpeaking() = main.post { tts?.stop() }.let { }
        @JavascriptInterface fun setWaypoint(lat: Double, lng: Double, name: String) = main.post {
            // 포장 매장을 Pleos 내비 경로의 첫 경유지로 넣는다
            log("경유지 추가 $name")
            navi.addWaypoint(RequestWaypointInfo(lat, lng, name, WaypointIndex.FIRST, "", "", "0", ""))
            waypointSet = true
        }.let { }
        @JavascriptInterface fun clearWaypoint() = main.post {
            if (waypointSet) navi.removeWaypoint(WaypointIndex.ALL)
            waypointSet = false
            wpSec = null
        }.let { }
        @JavascriptInterface fun openNavi() = main.post { navi.requestNavigationScreen(NavigationScreenRequest.Foreground) }.let { }
    }

    private fun js(code: String) = main.post { web.evaluateJavascript(code, null) }

    // ───────── Pleos SpeechToText / TextToSpeech ─────────
    private val sttListener = object : ResultListener {
        override fun onReady() = Unit
        override fun onStartedRecognition() = log("음성 인식 시작")
        override fun onUpdated(stt: String, completed: Boolean) {
            // 중간 결과는 말풍선, 최종 결과는 Gleo 대화로 (car.js window.driveonHeard)
            js("window.driveonHeard && window.driveonHeard(${JSONObject.quote(stt)}, $completed)")
        }
        override fun onUpdatedEpdData(on: Long, off: Long) = Unit
        override fun onUpdatedRms(rms: Double) = Unit
        override fun onEndedRecognition() {
            js("window.driveonListenEnded && window.driveonListenEnded()")
        }
        override fun onError(errorType: SttError) {
            log("음성 인식 오류 $errorType")
            js("window.driveonListenEnded && window.driveonListenEnded(${JSONObject.quote("음성 인식 오류: $errorType")})")
        }
    }

    private val ttsListener = object : EventListener {
        override fun onReady() = Unit
        override fun onStart() = log("안내 음성 재생")
        override fun onUpdatedRms(rms: Double) = Unit
        override fun onDone() = Unit
        override fun onStop() = Unit
        override fun onError(errorType: TtsError) = log("안내 음성 오류 $errorType")
    }

    private fun initSpeech() {
        // 키가 있으면 HYBRID(서버 우선, 끊기면 온디바이스), 없으면 ON_DEVICE
        val s = SpeechToText(applicationContext, if (hasKey) SttMode.HYBRID else SttMode.ON_DEVICE)
        s.initialize(object : SttInit {
            override fun onSuccess() {
                s.addListener(sttListener)
                s.setLocale(Locale.KOREA)
                if (hasKey) s.registerApp(BuildConfig.PLEOS_CLIENT_ID, BuildConfig.PLEOS_CLIENT_SECRET, object : SttServer {
                    override fun onConnected() = log("STT 서버 연결됨")
                    override fun onFailed(errorType: SttError) = log("STT 서버 연결 실패 $errorType (온디바이스로 계속)")
                })
                stt = s
                log("STT 준비됨 (${if (hasKey) "HYBRID" else "ON_DEVICE"})")
            }
            override fun onFailure(errorType: SttError) = log("STT 초기화 실패 $errorType")
        })
        val t = TextToSpeech(applicationContext, if (hasKey) TtsMode.HYBRID else TtsMode.ON_DEVICE)
        t.initialize(object : TtsInit {
            override fun onSuccess() {
                t.addEventListener(ttsListener)
                t.setLocale(Locale.KOREA)
                if (hasKey) t.registerApp(BuildConfig.PLEOS_CLIENT_ID, BuildConfig.PLEOS_CLIENT_SECRET, object : TtsServer {
                    override fun onConnected() = log("TTS 서버 연결됨")
                    override fun onFailed(errorType: TtsError) = log("TTS 서버 연결 실패 $errorType (온디바이스로 계속)")
                })
                tts = t
                log("TTS 준비됨")
            }
            override fun onFailure(errorType: TtsError) = log("TTS 초기화 실패 $errorType")
        })
    }

    private fun startListening() {
        val s = stt ?: return js("window.driveonListenEnded && window.driveonListenEnded('음성 인식 준비 중이에요')").let { }
        tts?.stop()
        s.request()
    }

    // ───────── Android Automotive: 주행 중 화면 제한 · 차속 · 기어 ─────────
    private fun initVehicle() {
        val c = Car.createCar(applicationContext) ?: return log("Car 서비스 없음")
        car = c
        (c.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE) as? CarUxRestrictionsManager)?.let { m ->
            restricted = m.currentCarUxRestrictions?.isRequiresDistractionOptimization == true
            m.registerListener { r: CarUxRestrictions ->
                restricted = r.isRequiresDistractionOptimization
                reportVehicle()
            }
        }
        (c.getCarManager(Car.PROPERTY_SERVICE) as? CarPropertyManager)?.let { pm ->
            val cb = object : CarPropertyManager.CarPropertyEventCallback {
                override fun onChangeEvent(v: CarPropertyValue<*>) {
                    when (v.propertyId) {
                        VehiclePropertyIds.PERF_VEHICLE_SPEED -> speedKmh = ((v.value as? Float) ?: 0f) * 3.6f
                        VehiclePropertyIds.GEAR_SELECTION -> gear = gearName(v.value as? Int)
                    }
                    reportVehicle()
                }
                override fun onErrorEvent(propertyId: Int, zone: Int) = Unit
            }
            runCatching { pm.registerCallback(cb, VehiclePropertyIds.PERF_VEHICLE_SPEED, 1f) }.onFailure { log("차속 구독 실패 $it") }
            runCatching { pm.registerCallback(cb, VehiclePropertyIds.GEAR_SELECTION, 0f) }.onFailure { log("기어 구독 실패 $it") }
        }
        reportVehicle()
    }

    private fun gearName(g: Int?) = when (g) {
        VehicleGear.GEAR_PARK -> "P"; VehicleGear.GEAR_REVERSE -> "R"; VehicleGear.GEAR_NEUTRAL -> "N"
        VehicleGear.GEAR_DRIVE -> "D"; null -> null; else -> "D"
    }

    private var lastVehicle = ""
    private fun reportVehicle() {
        val key = "$restricted|${speedKmh.toInt()}|$gear"
        if (key == lastVehicle) return
        lastVehicle = key
        send("/car/vehicle", JSONObject().put("restricted", restricted).put("speedKmh", speedKmh.toInt()).put("gear", gear ?: JSONObject.NULL))
    }

    // ───────── 앱 ─────────
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#06090E"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            addJavascriptInterface(Bridge(), "DriveOnNative") // 페이지가 읽기 전에 넣는다
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
            addView(badge, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.START))
        })

        showBadge("📡 Pleos 연결 중…")
        navi = NaviHelper(applicationContext)
        navi.initialize(
            onConnected = {
                main.post {
                    navi.addListener(naviListener)
                    navi.getDestinationInfo()
                    main.postDelayed(poll, 3_000)
                }
            },
            onFailed = { e -> main.post { showBadge("📡 내비 연결 실패: ${e.message}") } },
        )
        initSpeech()
        runCatching { initVehicle() }.onFailure { log("차량 상태 연결 실패 $it") }
    }

    override fun onDestroy() {
        main.removeCallbacks(poll)
        runCatching { navi.removeListener(naviListener); navi.release() }
        runCatching { stt?.removeListener(sttListener); stt?.release() }
        runCatching { tts?.removeEventListener(ttsListener); tts?.release() }
        runCatching { car?.disconnect() }
        io.shutdown()
        web.destroy()
        super.onDestroy()
    }

    // ───────── 공통 ─────────
    private fun send(path: String, json: JSONObject) {
        val body = json.toString()
        io.execute {
            try {
                val c = URL(server + path).openConnection() as HttpURLConnection
                c.requestMethod = "POST"
                c.connectTimeout = 3000
                c.readTimeout = 3000
                c.doOutput = true
                c.setRequestProperty("content-type", "application/json")
                c.outputStream.use { it.write(body.toByteArray()) }
                val code = c.responseCode
                c.disconnect()
                if (code !in 200..299) Log.w(tag, "$path → $code")
            } catch (e: Exception) {
                Log.w(tag, "$path 실패: $e")
                main.post { showBadge("⚠ 서버 연결 실패 ($server) — PC에서 npm start 확인") }
            }
        }
    }

    private fun showBadge(text: String) {
        badge.text = text
        Log.d(tag, text)
    }

    private fun log(text: String) {
        Log.d(tag, text)
    }
}
