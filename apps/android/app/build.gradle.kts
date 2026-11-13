// Reference: ../refs/DAF/daf3/apps/mobile/android/app/build.gradle.kts (native build configuration only).
import kr.goltou.buildconfig.ReleaseConfig

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val repository = rootDir.resolve("../..").canonicalFile
val appVersion = ReleaseConfig.version(rootDir.resolve("version.properties"))
val signingFile = System.getenv("GOLTOU_SIGNING_PROPERTIES")?.takeIf { it.isNotBlank() }
    ?.let { file(it) } ?: rootDir.resolve("release-signing.properties")
// Keep debug usable without signing credentials; release validation always fails closed.
val signingResult = runCatching { ReleaseConfig.signing(repository, signingFile) }
val validateReleaseSigning = tasks.register("validateReleaseSigning") {
    doLast { signingResult.getOrThrow() }
}

android {
    namespace = "kr.goltou.auto"
    buildFeatures { buildConfig = true }
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    ndkVersion = "27.3.13750724"
    defaultConfig {
        applicationId = "kr.goltou.auto"
        minSdk = 30
        targetSdk = 36
        versionCode = appVersion.getProperty("versionCode").toInt()
        versionName = appVersion.getProperty("versionName")
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
        externalNativeBuild { cmake { cppFlags += "-std=c++17"; arguments += "-DANDROID_STL=c++_shared" } }
    }
    signingConfigs {
        create("release") {
            signingResult.getOrNull()?.let { values ->
                storeFile = file(values.getProperty("storeFile"))
                storePassword = values.getProperty("storePassword")
                keyAlias = values.getProperty("keyAlias")
                keyPassword = values.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            externalNativeBuild { cmake { arguments += "-DGOLTOU_DEBUG_LOGS=ON" } }
        }
        getByName("release") {
            isDebuggable = false
            isJniDebuggable = false
            // JNI/node::Start and the embedded runtime have not been validated with R8.
            isMinifyEnabled = false
            isShrinkResources = false
            signingConfig = signingConfigs.getByName("release")
            externalNativeBuild { cmake { arguments += "-DGOLTOU_DEBUG_LOGS=OFF" } }
        }
    }
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging { jniLibs { useLegacyPackaging = true } }
    // Sideloaded APKs do not need Play's encrypted, non-deterministic SDK metadata.
    dependenciesInfo { includeInApk = false; includeInBundle = false }
    sourceSets["main"].jniLibs.srcDirs("libnode/bin")
    // Never package the shared, possibly debug, assets left by a manual pnpm build.
    sourceSets["main"].assets.setSrcDirs(emptyList<String>())
    for (variant in listOf("debug", "release")) {
        sourceSets[variant].assets.setSrcDirs(listOf(layout.buildDirectory.dir("generated/$variant-core/android-assets")))
    }
    androidResources { noCompress += listOf("cjs", "js", "html", "json") }
}
for (variant in listOf("debug", "release")) {
    val capitalized = variant.replaceFirstChar { it.uppercase() }
    val bundle = tasks.register<Exec>("bundle${capitalized}Core") {
        if (variant == "release") dependsOn(validateReleaseSigning)
        workingDir(repository)
        commandLine("node", "scripts/build-core.mjs", "--out",
            layout.buildDirectory.dir("generated/$variant-core").get().asFile.absolutePath,
            *if (variant == "release") arrayOf("--release") else emptyArray<String>())
        inputs.files(fileTree(repository.resolve("packages")) { exclude("**/node_modules/**", "**/dist/**") },
            fileTree(repository.resolve("scripts")), fileTree(rootDir.resolve("bridge")),
            rootDir.resolve("version.properties"), repository.resolve("pnpm-lock.yaml"))
        outputs.dir(layout.buildDirectory.dir("generated/$variant-core"))
    }
    tasks.matching { it.name == "pre${capitalized}Build" }.configureEach { dependsOn(bundle) }
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
dependencies {
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
