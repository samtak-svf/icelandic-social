# The UniFFI bindings reach the Rust core through JNA, which finds methods and
# structure fields by reflection.
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
-keep class samtak.spjall.core.** { *; }
-dontwarn java.awt.**
