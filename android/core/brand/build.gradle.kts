// Every file under src/generated/ is written by `pnpm brand:gen` (tooling/brand-gen.mjs).
plugins {
    id("spjall.android.library")
}

android {
    namespace = "samtak.spjall.brand"
    lint {
        // The relative-time strings are invariant abbreviations ("5 vik."), which no plural form changes.
        disable += "PluralsCandidate"
    }
}

androidComponents {
    onVariants { variant ->
        variant.sources.res?.addStaticSourceDirectory("src/generated/res")
        variant.sources.kotlin?.addStaticSourceDirectory("src/generated/kotlin")
    }
}
