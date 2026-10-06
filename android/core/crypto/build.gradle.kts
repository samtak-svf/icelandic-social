import samtak.spjall.gradle.SyncGeneratedSources
import samtak.spjall.gradle.UnpackJniLibs

// The Rust core (decision 0002) as the app loads it: the .so files from the
// AAR and the UniFFI Kotlin bindings next to it. Both are written into libs/
// by `cargo xtask core android` (a local build) or `cargo xtask fetch android`
// (the published version pinned in core/artifact.lock.json). Gradle never
// builds or downloads the core itself (tooling/core-guard.mjs).
plugins {
    id("spjall.android.library")
}

android {
    namespace = "samtak.spjall.crypto"
}

val coreDir = layout.projectDirectory.dir("libs")
if (!coreDir.file("spjall-core.aar").asFile.exists()) {
    throw GradleException(
        "android/core/crypto/libs/ is empty. Build the core (cargo xtask core android) " +
            "or fetch the pinned one (cargo xtask fetch android) from core/.",
    )
}

androidComponents {
    onVariants { variant ->
        val name = variant.name.replaceFirstChar(Char::uppercase)
        val bindings =
            tasks.register<SyncGeneratedSources>("sync${name}CoreBindings") {
                sourceDir.set(coreDir.dir("kotlin"))
            }
        val jniLibs =
            tasks.register<UnpackJniLibs>("unpack${name}CoreJniLibs") {
                aar.set(coreDir.file("spjall-core.aar"))
            }
        variant.sources.kotlin?.addGeneratedSourceDirectory(bindings, SyncGeneratedSources::outputDir)
        variant.sources.jniLibs?.addGeneratedSourceDirectory(jniLibs, UnpackJniLibs::outputDir)
    }
}

dependencies {
    // UniFFI's Kotlin bindings call the core through JNA; the AAR carries
    // JNA's own native dispatch library for each ABI.
    implementation(variantOf(libs.jna) { artifactType("aar") })
    testImplementation(libs.junit)
}
