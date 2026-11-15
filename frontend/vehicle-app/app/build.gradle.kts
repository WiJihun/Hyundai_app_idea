import java.util.Properties

plugins {
    id("com.android.application")
}

// Pleos Playground My Project의 Client ID·Secret(서버 음성 인식·합성용). 코드·GitHub에는 올리지 않고 local.properties에만 둔다.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun local(key: String) = (localProps.getProperty(key) ?: "").replace("\"", "")

android {
    namespace = "ai.driveon.car"
    compileSdk = 37

    defaultConfig {
        applicationId = "ai.driveon.car"
        minSdk = 28 // Pleos Connect 요구사항: API 28 이상
        targetSdk = 34 // Pleos Connect 에뮬레이터 = Android 14 (API 34)
        versionCode = 1
        versionName = "0.2"
        buildConfigField("String", "PLEOS_CLIENT_ID", "\"${local("pleos.clientId")}\"")
        buildConfigField("String", "PLEOS_CLIENT_SECRET", "\"${local("pleos.clientSecret")}\"")
    }
    buildFeatures { buildConfig = true }
    // Android Automotive: 주행 중 화면 제한(CarUxRestrictions) · 차속 · 기어(CarPropertyManager)
    useLibrary("android.car")
}

dependencies {
    // Pleos Connect NaviHelper SDK: 목적지까지 남은 시간·거리, 경유지, 경로 이벤트
    implementation("ai.pleos.playground:NaviHelper:3.0.5")
    // Pleos 음성 인식·합성 (HYBRID: 서버 인식 + 끊기면 온디바이스, 키가 없으면 ON_DEVICE)
    implementation("ai.pleos.playground:SpeechToText:3.3.1")
    implementation("ai.pleos.playground:TextToSpeech:3.3.1")
}
