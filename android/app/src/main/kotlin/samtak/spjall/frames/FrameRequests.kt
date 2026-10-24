package samtak.spjall.frames

import samtak.spjall.core.FrameKind
import samtak.spjall.core.Framing
import java.io.File

/**
 * A request to frame a picture the person has just picked (decision 0086): [read] makes its master, [save] sends the
 * master and then the framing. The file is deleted when the sheet closes unless [release] says otherwise.
 */
fun newImageRequest(
    kind: FrameKind,
    read: () -> File,
    release: (File, Boolean) -> Unit = { file, _ -> file.delete() },
    save: suspend (File, Framing) -> Unit,
): FrameRequest {
    var master: File? = null
    return FrameRequest(
        kind = kind,
        base = { null },
        master = { read().also { master = it } },
        save = { framing -> save(checkNotNull(master) { "saved before the master was read" }, framing) },
        release = release,
    )
}

/**
 * A request to frame again a picture the server already holds: the master comes down through [source] into the file
 * [temp] makes; [source] is false for a picture set before masters were kept.
 */
fun storedImageRequest(
    kind: FrameKind,
    base: () -> Framing?,
    source: (String) -> Boolean,
    temp: () -> File,
    save: suspend (Framing) -> Unit,
): FrameRequest =
    FrameRequest(
        kind = kind,
        base = { base() },
        master = {
            val file = temp()
            if (source(file.path)) {
                file
            } else {
                file.delete()
                null
            }
        },
        save = save,
    )
