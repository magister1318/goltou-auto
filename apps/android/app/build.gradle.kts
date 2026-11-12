// Reference: ../refs/DAF/daf3/apps/mobile/android/app/build.gradle.kts (native build configuration only).
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "kr.goltou.auto"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    ndkVersion = "27.3.13750724"
    defaultConfig {
        applicationId = "kr.goltou.auto"
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
        externalNativeBuild { cmake { cppFlags += "-std=c++17"; arguments += "-DANDROID_STL=c++_shared" } }
    }
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging { jniLibs { useLegacyPackaging = true } }
    sourceSets["main"].jniLibs.srcDirs("libnode/bin")
    androidResources { noCompress += listOf("cjs", "js", "html", "json") }
}
// WP1 has debug signing only. No release variant or release keystore.
androidComponents.beforeVariants(androidComponents.selector().all()) { variant ->
    if (variant.buildType != "debug") variant.enable = false
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
dependencies {
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
