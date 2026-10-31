package samtak.spjall.social

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import samtak.spjall.brand.R
import samtak.spjall.core.PersonProfile
import samtak.spjall.me.Confirm
import samtak.spjall.ui.AppIcons
import samtak.spjall.ui.Avatar
import samtak.spjall.ui.AvatarKind
import samtak.spjall.ui.Palette
import samtak.spjall.ui.PhotoOf

@Composable
internal fun AvatarWithCamera(
    profile: PersonProfile,
    own: Boolean,
    actions: PersonActions,
) {
    var menu by rememberSaveable { mutableStateOf(false) }
    var removing by rememberSaveable { mutableStateOf(false) }
    val hasPhoto = profile.photo != null
    Box {
        Avatar(
            name = profile.name,
            kind = if (profile.verified) AvatarKind.Verified else AvatarKind.Unverified,
            size = 64.dp,
            photo = profile.photo?.let { PhotoOf(profile.accountId, it) },
        )
        // The web's camera on the avatar: choose or replace, frame again, or remove the photo, as the web's menu does.
        if (own && !suspended()) {
            IconButton(
                onClick = { menu = true },
                modifier = Modifier.align(Alignment.BottomEnd).size(CAMERA.dp).testTag("avatar-camera"),
            ) {
                Icon(
                    AppIcons.Camera,
                    stringResource(R.string.photo_change),
                    tint = Palette.fg,
                    modifier = Modifier.size(CAMERA_MARK.dp).background(Palette.surface, CircleShape),
                )
            }
            PhotoMenu(menu, hasPhoto, actions, { menu = false }) { removing = true }
        }
    }
    if (removing) {
        Confirm(
            text = stringResource(R.string.photo_remove_confirm),
            confirm = stringResource(R.string.photo_remove),
            onConfirm = {
                removing = false
                actions.removePhoto()
            },
            onDismiss = { removing = false },
        )
    }
}

/** The menu behind the camera on the avatar: choose or replace, frame again, or ask to remove the photo. */
@Composable
private fun PhotoMenu(
    open: Boolean,
    hasPhoto: Boolean,
    actions: PersonActions,
    close: () -> Unit,
    remove: () -> Unit,
) {
    DropdownMenu(expanded = open, onDismissRequest = close) {
        val choose = stringResource(if (hasPhoto) R.string.photo_change else R.string.photo_choose)
        PhotoItem(choose, "photo-choose") {
            close()
            actions.choosePhoto()
        }
        if (hasPhoto) {
            PhotoItem(stringResource(R.string.image_frames_title), "photo-reframe") {
                close()
                actions.reframePhoto()
            }
            PhotoItem(stringResource(R.string.photo_remove), "photo-remove") {
                close()
                remove()
            }
        }
        // Who sees the photo is said where it is changed (decision 0039).
        DropdownMenuItem(
            text = {
                Text(stringResource(R.string.photo_seen_by_all), style = MaterialTheme.typography.bodySmall)
            },
            onClick = {},
            enabled = false,
        )
    }
}

@Composable
private fun PhotoItem(
    text: String,
    tag: String,
    onClick: () -> Unit,
) = DropdownMenuItem(text = { Text(text) }, onClick = onClick, modifier = Modifier.testTag(tag))

private const val CAMERA = 28
private const val CAMERA_MARK = 22
