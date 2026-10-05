package samtak.spjall.gradle

import com.android.build.api.dsl.ApplicationExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure

class AndroidApplicationConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) =
        with(target) {
            pluginManager.apply("com.android.application")
            extensions.configure<ApplicationExtension> {
                compileSdk = COMPILE_SDK
                defaultConfig {
                    minSdk = MIN_SDK
                    targetSdk = TARGET_SDK
                    // The ABIs `cargo xtask core android` builds; JNA would add
                    // armeabi and mips, which no supported device runs.
                    ndk.abiFilters += setOf("arm64-v8a", "armeabi-v7a", "x86_64", "x86")
                }
                compileOptions {
                    sourceCompatibility = JAVA_VERSION
                    targetCompatibility = JAVA_VERSION
                }
                lint.spjallDefaults()
                testOptions.unitTests.spjallDefaults()
            }
            configureQuality()
        }
}
