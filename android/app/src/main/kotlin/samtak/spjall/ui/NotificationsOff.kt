package samtak.spjall.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import samtak.spjall.brand.R

/**
 * Says the system blocks the app's notifications, with the way to the system's settings. It cannot be
 * dismissed: a messenger whose notifications are off fails silently, so it shows until they are on again.
 */
@Composable
fun NotificationsOff(onSettings: () -> Unit) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(Palette.secondarySubtle, RoundedCornerShape(RADIUS.dp))
                .padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(AppIcons.BellOff, contentDescription = null, tint = Palette.fg, modifier = Modifier.size(ICON.dp))
        Column {
            Text(text = stringResource(R.string.notifications_off), style = HINT, color = Palette.fg)
            TextButton(onClick = onSettings, contentPadding = ButtonDefaults.TextButtonWithIconContentPadding) {
                Text(stringResource(R.string.notifications_settings), style = ACTION, color = Palette.primary)
            }
        }
    }
}

private const val RADIUS = 14
private const val ICON = 18

private val HINT =
    TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, lineHeight = 18.sp)
private val ACTION = TextStyle(fontFamily = SansFamily, fontWeight = FontWeight.Black, fontSize = 13.5.sp)
