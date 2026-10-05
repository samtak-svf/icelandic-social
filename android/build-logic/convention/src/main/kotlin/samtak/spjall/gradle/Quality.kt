package samtak.spjall.gradle

import dev.detekt.gradle.extensions.DetektExtension
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure

/**
 * ktlint and detekt on hand-written Kotlin. Generated code (OpenAPI models,
 * UniFFI bindings) reaches AGP through the variant API as generated sources,
 * which neither tool reads, so nothing has to be excluded by path.
 */
internal fun Project.configureQuality() {
    pluginManager.apply("org.jlleitschuh.gradle.ktlint")
    pluginManager.apply("dev.detekt")
    extensions.configure<DetektExtension> {
        buildUponDefaultConfig.set(true)
        config.setFrom(rootProject.file("config/detekt.yml"))
    }
}
