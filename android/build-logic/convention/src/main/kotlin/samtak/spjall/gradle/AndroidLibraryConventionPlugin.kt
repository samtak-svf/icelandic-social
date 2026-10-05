package samtak.spjall.gradle

import com.android.build.api.dsl.LibraryExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure

class AndroidLibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) =
        with(target) {
            pluginManager.apply("com.android.library")
            extensions.configure<LibraryExtension> {
                compileSdk = COMPILE_SDK
                defaultConfig.minSdk = MIN_SDK
                compileOptions {
                    sourceCompatibility = JAVA_VERSION
                    targetCompatibility = JAVA_VERSION
                }
                lint.spjallDefaults()
                testOptions.unitTests.spjallDefaults()
            }
            // :core:brand holds only brand-gen output, held to brand/ byte for
            // byte by pnpm check:brand-gen; style tools have nothing to say there.
            if (findProperty("spjall.generated") != "true") configureQuality()
        }
}
