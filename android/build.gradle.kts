// Plugins are resolved here once; the convention plugins in build-logic/
// apply them by id and compile only against their APIs.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ktlint) apply false
    alias(libs.plugins.detekt) apply false
    alias(libs.plugins.openapi.generator) apply false
    alias(libs.plugins.roborazzi) apply false
}
