import org.openapitools.generator.gradle.plugin.tasks.GenerateTask
import samtak.spjall.gradle.SyncGeneratedSources

// The HTTP client is generated at build time from api/openapi.json, the
// contract the Worker's zod schemas produce (decision 0005), and is never
// committed. The WebSocket frames are the committed api/kotlin/ output of
// tooling/ws-kotlin.mjs, which contract.yml keeps current.
plugins {
    id("spjall.android.library")
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.openapi.generator)
}

android {
    namespace = "samtak.spjall.network"
}

val apiDir = rootProject.layout.projectDirectory.dir("../api")

val openApiGenerate =
    tasks.named<GenerateTask>("openApiGenerate") {
        generatorName.set("kotlin")
        inputSpec.set(apiDir.file("openapi.json").asFile.path)
        outputDir.set(layout.buildDirectory.dir("openapi"))
        packageName.set("samtak.spjall.api.rest")
        library.set("jvm-okhttp4")
        configOptions.set(mapOf("serializationLibrary" to "kotlinx_serialization", "omitGradleWrapper" to "true"))
        generateApiTests.set(false)
        generateModelTests.set(false)
        generateApiDocumentation.set(false)
        generateModelDocumentation.set(false)
    }

androidComponents {
    onVariants { variant ->
        val name = variant.name.replaceFirstChar(Char::uppercase)
        val rest =
            tasks.register<SyncGeneratedSources>("sync${name}RestClient") {
                sourceDir.set(openApiGenerate.flatMap { it.outputDir.dir("src/main/kotlin") })
            }
        val frames =
            tasks.register<SyncGeneratedSources>("sync${name}WsFrames") {
                sourceDir.set(apiDir.dir("kotlin"))
            }
        variant.sources.kotlin?.addGeneratedSourceDirectory(rest, SyncGeneratedSources::outputDir)
        variant.sources.kotlin?.addGeneratedSourceDirectory(frames, SyncGeneratedSources::outputDir)
    }
}

dependencies {
    api(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    testImplementation(libs.junit)
}
