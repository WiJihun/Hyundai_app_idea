plugins {
    id("com.android.application")
}

android {
    namespace = "ai.driveon.car"
    compileSdk = 37

    defaultConfig {
        applicationId = "ai.driveon.car"
        minSdk = 28 // Pleos Connect 요구사항: API 28 이상
        targetSdk = 34 // Pleos Connect 에뮬레이터 = Android 14 (API 34)
        versionCode = 1
        versionName = "0.1"
    }
}

dependencies {
    // Pleos Connect NaviHelper SDK: 목적지까지 남은 시간·거리, 경유지, 경로 이벤트
    implementation("ai.pleos.playground:NaviHelper:3.0.5")
}
