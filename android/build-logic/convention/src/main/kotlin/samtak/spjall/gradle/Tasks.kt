package samtak.spjall.gradle

import org.gradle.api.DefaultTask
import org.gradle.api.file.ArchiveOperations
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.FileSystemOperations
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.file.RelativePath
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.gradle.work.DisableCachingByDefault
import javax.inject.Inject

/**
 * Copies a directory of generated sources into a task output, so AGP can take
 * it with `addGeneratedSourceDirectory` and treat it as generated: lint,
 * ktlint and detekt then leave it alone.
 */
@DisableCachingByDefault(because = "a local copy is cheaper than a cache entry")
abstract class SyncGeneratedSources : DefaultTask() {
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sourceDir: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val files: FileSystemOperations

    @TaskAction
    fun sync() {
        files.sync {
            from(sourceDir)
            into(outputDir)
        }
    }
}

/** Unpacks the native libraries under `jni/<abi>/` of an AAR into `<abi>/`, the jniLibs layout. */
@DisableCachingByDefault(because = "a local unzip is cheaper than a cache entry")
abstract class UnpackJniLibs : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val aar: RegularFileProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val files: FileSystemOperations

    @get:Inject
    abstract val archives: ArchiveOperations

    @TaskAction
    fun unpack() {
        files.sync {
            from(archives.zipTree(aar)) {
                include("jni/**")
                eachFile { relativePath = RelativePath(true, *relativePath.segments.drop(1).toTypedArray()) }
            }
            into(outputDir)
            includeEmptyDirs = false
        }
    }
}
