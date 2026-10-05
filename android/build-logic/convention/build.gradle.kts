plugins {
    `kotlin-dsl`
}

dependencies {
    compileOnly(libs.android.gradlePlugin)
    compileOnly(libs.compose.gradlePlugin)
    compileOnly(libs.detekt.gradlePlugin)
}

gradlePlugin {
    plugins {
        register("androidApplication") {
            id = "spjall.android.application"
            implementationClass = "samtak.spjall.gradle.AndroidApplicationConventionPlugin"
        }
        register("androidLibrary") {
            id = "spjall.android.library"
            implementationClass = "samtak.spjall.gradle.AndroidLibraryConventionPlugin"
        }
        register("compose") {
            id = "spjall.compose"
            implementationClass = "samtak.spjall.gradle.ComposeConventionPlugin"
        }
        register("brand") {
            id = "spjall.brand"
            implementationClass = "samtak.spjall.gradle.BrandConventionPlugin"
        }
    }
}
