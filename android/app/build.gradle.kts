import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    id("spjall.android.application")
    id("spjall.compose")
    id("spjall.brand")
}

// A debug build can point at a local `cf dev` instead of the deployed
// Worker: `spjall.debugApiBaseUrl` in local.properties (gitignored) or
// SPJALL_DEBUG_API_BASE_URL, e.g. http://10.0.2.2:8787 from the emulator.
val debugApiBaseUrl: String? =
    rootProject
        .file("local.properties")
        .takeIf { it.exists() }
        ?.let { file -> Properties().apply { file.reader(Charsets.UTF_8).use(::load) } }
        ?.getProperty("spjall.debugApiBaseUrl")
        ?: providers.environmentVariable("SPJALL_DEBUG_API_BASE_URL").orNull

// Push (decision 0025) needs the Firebase app's client values. They are read
// from the google-services.json the Firebase console gives, without the
// google-services plugin; with no such file the build has no push, so forks
// and CI build without one.
data class FirebaseApp(
    val appId: String,
    val apiKey: String,
    val senderId: String,
    val projectId: String,
)

val firebase: FirebaseApp? =
    file("google-services.json").takeIf { it.exists() }?.let { file ->
        val json = JsonSlurper().parse(file) as Map<*, *>
        val project = json["project_info"] as Map<*, *>
        val ids = JsonSlurper().parse(rootProject.file("../identifiers/ids.json")) as Map<*, *>
        val expected = (ids["services"] as Map<*, *>)["firebaseProjectId"]
        check(project["project_id"] == expected) {
            "google-services.json is for ${project["project_id"]}, and identifiers/ids.json names $expected"
        }
        val applicationId = (ids["store"] as Map<*, *>)["androidApplicationId"]
        val client =
            (json["client"] as List<*>).map { it as Map<*, *> }.single {
                ((it["client_info"] as Map<*, *>)["android_client_info"] as Map<*, *>)["package_name"] == applicationId
            }
        FirebaseApp(
            appId = (client["client_info"] as Map<*, *>)["mobilesdk_app_id"] as String,
            apiKey = ((client["api_key"] as List<*>).first() as Map<*, *>)["current_key"] as String,
            senderId = project["project_number"] as String,
            projectId = project["project_id"] as String,
        )
    }

android {
    // Not the application id: `is` is a Kotlin keyword (decision 0004).
    namespace = "samtak.spjall"

    defaultConfig {
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        versionCode = 2
        versionName = "0.2.0"
        buildConfigField("String", "FIREBASE_APP_ID", "\"${firebase?.appId.orEmpty()}\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"${firebase?.apiKey.orEmpty()}\"")
        buildConfigField("String", "FIREBASE_SENDER_ID", "\"${firebase?.senderId.orEmpty()}\"")
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${firebase?.projectId.orEmpty()}\"")
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
    implementation(libs.androidx.exifinterface)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.material.icons.core)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.zxing.core)
    implementation(libs.firebase.messaging)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
    debugImplementation(libs.androidx.ui.test.manifest)
}
