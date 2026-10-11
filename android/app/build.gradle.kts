import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    id("spjall.android.application")
    id("spjall.compose")
    id("spjall.brand")
    alias(libs.plugins.roborazzi)
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

// A Play build (android-play.yml) signs with the organisation's upload key
// and numbers itself from the run; a local release build stays unsigned.
fun env(name: String): String? = providers.environmentVariable(name).orNull?.takeIf { it.isNotEmpty() }

val uploadStoreFile: String? = env("SPJALL_UPLOAD_STORE_FILE")

// Above the hand-set codes of the builds before the Play lane.
val playVersionCodeOffset = 100

android {
    // Not the application id: `is` is a Kotlin keyword (decision 0004).
    namespace = "samtak.spjall"

    defaultConfig {
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        versionCode = env("SPJALL_VERSION_CODE")?.toInt()?.plus(playVersionCodeOffset) ?: 2
        versionName = "0.5.0"
        buildConfigField("String", "FIREBASE_APP_ID", "\"${firebase?.appId.orEmpty()}\"")
        buildConfigField("String", "FIREBASE_API_KEY", "\"${firebase?.apiKey.orEmpty()}\"")
        buildConfigField("String", "FIREBASE_SENDER_ID", "\"${firebase?.senderId.orEmpty()}\"")
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${firebase?.projectId.orEmpty()}\"")
    }

    signingConfigs {
        if (uploadStoreFile != null) {
            create("upload") {
                storeFile = file(uploadStoreFile)
                storePassword = env("SPJALL_UPLOAD_STORE_PASSWORD")
                keyAlias = env("SPJALL_UPLOAD_KEY_ALIAS")
                keyPassword = env("SPJALL_UPLOAD_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            debugApiBaseUrl?.let { buildConfigField("String", "API_BASE_URL", "\"$it\"") }
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfigs.findByName("upload")?.let { signingConfig = it }
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    // The screenshot tests (Roborazzi on Robolectric) render the real
    // resources: the brand's fonts, strings and icons.
    testOptions.unitTests.isIncludeAndroidResources = true
    // Robolectric's Android 16 sandbox reaches into the JDK's file
    // descriptors, which a JDK newer than 21 no longer exports by default.
    testOptions.unitTests.all { it.jvmArgs("--add-exports=java.base/jdk.internal.access=ALL-UNNAMED") }
}

// The baselines are committed next to the tests. Every unit test run, and so
// `./gradlew check`, compares against them (roborazzi.test.verify in
// gradle.properties); `./gradlew recordRoborazziDebug` rewrites them.
roborazzi {
    outputDir.set(layout.projectDirectory.dir("src/test/screenshots"))
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
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.ui.test.junit4)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
    debugImplementation(libs.androidx.ui.test.manifest)
}
