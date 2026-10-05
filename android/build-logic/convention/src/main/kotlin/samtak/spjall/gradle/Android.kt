package samtak.spjall.gradle

import com.android.build.api.dsl.Lint
import com.android.build.api.dsl.UnitTestOptions
import org.gradle.api.JavaVersion
import org.gradle.api.Project
import org.gradle.api.artifacts.VersionCatalog
import org.gradle.api.artifacts.VersionCatalogsExtension
import org.gradle.kotlin.dsl.getByType

internal const val COMPILE_SDK = 37
internal const val MIN_SDK = 26
internal const val TARGET_SDK = 36

internal val JAVA_VERSION = JavaVersion.VERSION_17

internal val Project.libs: VersionCatalog
    get() = extensions.getByType<VersionCatalogsExtension>().named("libs")

/** The repository root, one level above the Gradle build in `android/`. */
internal val Project.repoRoot
    get() = rootDir.parentFile

internal fun Lint.spjallDefaults() {
    warningsAsErrors = true
    abortOnError = true
    // Version moves (SDK levels, AGP, libraries) are deliberate PRs that edit
    // libs.versions.toml or this file, not something a lint run decides.
    disable += setOf("OldTargetApi", "GradleDependency", "AndroidGradlePluginVersion", "NewerVersionAvailable")
}

internal fun UnitTestOptions.spjallDefaults() {
    // A test class that is never found ends the task green, so name every
    // result in the log (the same lesson as rosaparks#313).
    all { test -> test.testLogging { events("passed", "skipped", "failed") } }
}
