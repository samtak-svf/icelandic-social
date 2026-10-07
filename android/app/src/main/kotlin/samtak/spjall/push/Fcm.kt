package samtak.spjall.push

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import samtak.spjall.BuildConfig
import samtak.spjall.SpjallApplication
import java.util.concurrent.Executors

/**
 * Firebase Cloud Messaging, set up from the build's Firebase app (app/build.gradle.kts)
 * rather than the google-services plugin. A build without one has no push.
 */
object Fcm {
    val configured get() = BuildConfig.FIREBASE_APP_ID.isNotEmpty()

    // The token's listener calls the core, which must not run on the main thread.
    private val background = Executors.newSingleThreadExecutor()

    fun start(
        context: Context,
        push: Push,
    ) {
        if (!configured) return
        val options =
            FirebaseOptions
                .Builder()
                .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                .setApiKey(BuildConfig.FIREBASE_API_KEY)
                .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                .build()
        if (FirebaseApp.getApps(context).isEmpty()) FirebaseApp.initializeApp(context, options)
        // Each launch: the core sends it only if the server does not have it.
        FirebaseMessaging.getInstance().token.addOnSuccessListener(background, push::token)
    }
}

/** Receives the contentless push and new tokens; both run off the main thread. */
class MessagingService : FirebaseMessagingService() {
    private val push get() = (application as SpjallApplication).graph.push

    override fun onMessageReceived(message: RemoteMessage) = push.wake()

    override fun onNewToken(token: String) = push.token(token)
}
