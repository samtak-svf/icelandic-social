package samtak.spjall.gradle

import com.android.build.api.dsl.ApplicationExtension
import groovy.json.JsonSlurper
import org.gradle.api.GradleException
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure

/**
 * The application's frozen ids and its link to the brand (decision 0004).
 *
 * The application id, the notification channel ids and the API host are read
 * from `identifiers/ids.json`, so no Gradle file repeats them. The brand
 * itself arrives as the generated `:core:brand` module; a checkout without its
 * files fails here with the command that writes them. Whether they are
 * current is `pnpm check:brand-gen`'s job, which CI runs on every PR.
 */
class BrandConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) =
        with(target) {
            val idsFile = repoRoot.resolve("identifiers/ids.json")
            val strings = repoRoot.resolve("android/core/brand/src/main/res/values/strings.xml")
            if (!strings.exists()) {
                throw GradleException("android/core/brand has no generated resources: run pnpm brand:gen")
            }
            val ids = Ids(JsonSlurper().parse(idsFile))
            pluginManager.withPlugin("com.android.application") {
                extensions.configure<ApplicationExtension> {
                    buildFeatures.buildConfig = true
                    defaultConfig {
                        applicationId = ids.string("store", "androidApplicationId")
                        buildConfigField("String", "API_BASE_URL", quoted("https://" + ids.string("hosts", "api")))
                        buildConfigField(
                            "String",
                            "CHANNEL_MESSAGES",
                            quoted(ids.string("store", "androidNotificationChannels", "messages")),
                        )
                        buildConfigField("String", "DATABASE_FILE", quoted(ids.string("store", "databaseFile")))
                    }
                }
            }
        }

    private fun quoted(value: String) = "\"$value\""

    private class Ids(
        private val root: Any?,
    ) {
        fun string(vararg path: String): String {
            val value =
                path.fold(root) { node, key ->
                    (node as? Map<*, *>)?.get(key)
                }
            return value as? String ?: throw GradleException("identifiers/ids.json has no string at ${path.joinToString(".")}")
        }
    }
}
