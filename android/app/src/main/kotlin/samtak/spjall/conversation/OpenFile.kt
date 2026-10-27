package samtak.spjall.conversation

import android.content.ActivityNotFoundException
import android.content.Context
import android.widget.Toast
import samtak.spjall.brand.R
import samtak.spjall.media.Files

/** Hands a fetched file to another app. */
internal fun openFile(
    context: Context,
    files: Files,
    opened: Opened,
) {
    try {
        context.startActivity(files.opener(opened.path, opened.mime, opened.name))
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(context, R.string.file_no_app, Toast.LENGTH_LONG).show()
    }
}
