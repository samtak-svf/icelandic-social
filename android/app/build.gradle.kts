import java.util.Properties

plugins {
    id("spjall.android.application")
    id("spjall.compose")
    id("spjall.brand")
}

// A debug build can point at a local `wrangler dev` instead of the deployed
// Worker: `spjall.debugApiBaseUrl` in local.properties (gitignored) or
// SPJALL_DEBUG_API_BASE_URL, e.g. http://10.0.2.2:8787 from the emulator.
val debugApiBaseUrl: String? =
    rootProject
        .file("local.properties")
        .takeIf { it.exists() }
        ?.let { file -> Properties().apply { file.reader(Charsets.UTF_8).use(::load) } }
        ?.getProperty("spjall.debugApiBaseUrl")
        ?: providers.environmentVariable("SPJALL_DEBUG_API_BASE_URL").orNull

android {
    // Not the application id: `is` is a Kotlin keyword (decision 0004).
    namespace = "samtak.spjall"

    defaultConfig {
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        debug {
            debugApiBaseUrl?.let { buildConfigField("String", "API_BASE_URL", "\"$it\"") }
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}

dependencies {
    implementation(project(":core:brand"))
    implementation(project(":core:crypto"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.browser)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.zxing.core)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
    debugImplementation(libs.androidx.ui.test.manifest)
}
