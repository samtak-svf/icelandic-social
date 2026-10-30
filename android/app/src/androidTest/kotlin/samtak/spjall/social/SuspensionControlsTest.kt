package samtak.spjall.social

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import samtak.spjall.brand.R
import samtak.spjall.conversation.ConversationActions
import samtak.spjall.conversation.ConversationScreen
import samtak.spjall.conversation.ConversationViewModel
import samtak.spjall.core.Author
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.Conversation
import samtak.spjall.core.ConversationState
import samtak.spjall.core.ModerationState
import samtak.spjall.core.Mute
import samtak.spjall.core.Person
import samtak.spjall.core.Poll
import samtak.spjall.core.PollOption
import samtak.spjall.core.Post
import samtak.spjall.ui.LocalSuspension
import samtak.spjall.ui.SpjallTheme
import samtak.spjall.ui.Suspension
import java.lang.reflect.Proxy

/**
 * The controls a suspension turns off (decision 0115): like, comment, post, vote, join and create a group. Each is
 * enabled without a suspension and disabled with one, with or without an end; a conversation's composer is never
 * touched by it.
 */
@RunWith(AndroidJUnit4::class)
class SuspensionControlsTest {
    @get:Rule val compose = createComposeRule()

    private fun text(id: Int) = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    private val ended = Suspension(until = 4_102_444_800_000uL)

    /** One composition, whose suspension is switched between the cases; a rule takes only one `setContent`. */
    private val current = mutableStateOf<Suspension?>(null)

    private fun under(content: @Composable () -> Unit) =
        compose.setContent {
            SpjallTheme {
                CompositionLocalProvider(LocalSuspension provides current.value) {
                    content()
                }
            }
        }

    /** Actions that do nothing: only the controls' state is looked at. */
    private inline fun <reified T> nothing(): T =
        Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { proxy, method, args ->
            when (method.name) {
                "equals" -> proxy === args[0]
                "hashCode" -> System.identityHashCode(proxy)
                "toString" -> "nothing"
                else -> null
            }
        } as T

    private val author = Author("a2", "Anna", verified = true)

    private fun post() =
        Post(
            postId = "p1",
            communityId = "k1",
            author = author,
            body = "Halló",
            images = emptyList(),
            createdAt = 1_700_000_000_000uL,
            emojis = emptyList(),
            myEmoji = null,
            commentCount = 0uL,
            state = ModerationState.VISIBLE,
            latestComment = null,
        )

    private fun community() =
        Community(
            communityId = "k1",
            name = "Kórinn",
            description = "",
            audience = CommunityAudience.OPEN,
            createdAt = 1_700_000_000_000uL,
            memberCount = 3uL,
            role = null,
            joinRequested = false,
            invited = false,
            mutedUntil = null,
            readOnly = false,
            deletedAt = null,
            joinDeclinedUntil = null,
            pendingJoinRequests = null,
            unread = 0uL,
            pinned = false,
            lastPostAt = null,
        )

    private val suspensions = listOf<Suspension?>(null, ended, Suspension(until = null))

    /** Runs [check] with no suspension, then one that ends, then one that does not. */
    private fun each(check: (Suspension?) -> Unit) =
        suspensions.forEach {
            current.value = it
            compose.waitForIdle()
            check(it)
        }

    @Test
    fun likeIsDisabledWhileSuspendedAndEnabledOtherwise() {
        val reacted = mutableListOf<String>()
        under {
            PostCard(
                post = post(),
                reacting = false,
                reported = false,
                callbacks = PostCardCallbacks(onReact = { reacted += it }, onReport = {}, onOpen = {}, onComment = {}),
            )
        }
        each { suspension ->
            val like = compose.onNodeWithText(text(R.string.post_like))
            if (suspension == null) like.assertIsEnabled().performClick() else like.assertIsNotEnabled()
        }
        assertEquals(1, reacted.size)
    }

    @Test
    fun commentSendAndItsPhotoButtonAreDisabledWhileSuspended() {
        under { CommentComposer(null, "Takk fyrir", false, onText = {}, onSend = {}) }
        each { suspension ->
            val send = compose.onNodeWithContentDescription(text(R.string.comment_publish))
            val photo = compose.onNodeWithContentDescription(text(R.string.comment_add_image))
            if (suspension == null) {
                send.assertIsEnabled()
                photo.assertIsEnabled()
            } else {
                send.assertIsNotEnabled()
                photo.assertIsNotEnabled()
            }
        }
    }

    @Test
    fun theCommunityPostBoxAndItsSendAreDisabledWhileSuspended() {
        under { Composer(label = "Skrifa", action = "Birta", text = "Halló", sending = false, onText = {}, onSend = {}) }
        each { suspension ->
            val field = compose.onNode(hasSetText)
            val send = compose.onNode(hasText("Birta") and hasClickAction())
            if (suspension == null) {
                field.assertIsEnabled()
                send.assertIsEnabled()
            } else {
                field.assertIsNotEnabled()
                send.assertIsNotEnabled()
            }
        }
    }

    @Test
    fun votingIsDisabledWhileSuspended() {
        val poll = Poll(listOf(PollOption("o0", "First", 1uL), PollOption("o1", "Second", 2uL)), 3uL, null, false)
        val voted = mutableListOf<String>()
        under {
            // The feed is a lazy list, which gives a card unbounded height; a bounded one would stretch each bar.
            Column(Modifier.verticalScroll(rememberScrollState())) {
                PollCard(poll, busy = false, callbacks = PollCallbacks({ voted += it }, {}, null))
            }
        }
        each { suspension ->
            val option = compose.onNodeWithTag("$POLL_OPTION-1")
            if (suspension == null) option.assertIsEnabled().performClick() else option.assertIsNotEnabled()
        }
        assertEquals(listOf("o1"), voted)
    }

    @Test
    fun joiningIsDisabledWhileSuspended() {
        under {
            CommunityScreen(
                CommunityViewModel.State(community = community(), loaded = true),
                nothing<CommunityActions>(),
            )
        }
        each { suspension ->
            val join = compose.onNode(hasText(text(R.string.community_join)) and hasClickAction())
            if (suspension == null) join.assertIsEnabled() else join.assertIsNotEnabled()
        }
    }

    @Test
    fun creatingAGroupIsDisabledInTheFormWhileSuspended() {
        under { CreateCommunityScreen(CreateCommunityViewModel.State(name = "Kórinn"), nothing<CreateCommunityActions>()) }
        each { suspension ->
            val create = compose.onNode(hasText(text(R.string.community_create)) and hasClickAction())
            if (suspension == null) create.assertIsEnabled() else create.assertIsNotEnabled()
        }
    }

    @Test
    fun theCreateRowOnTheListIsDisabledWhileSuspended() {
        under {
            CommunitiesScreen(
                CommunitiesViewModel.State(verified = true, loaded = true),
                nothing<CommunitiesActions>(),
            )
        }
        each { suspension ->
            val row = compose.onNode(hasText(text(R.string.community_create)) and hasClickAction())
            if (suspension == null) row.assertIsEnabled() else row.assertIsNotEnabled()
        }
    }

    @Test
    fun aConversationsComposerStaysEnabledUnderASuspension() {
        val anna = Person("a2", "Anna Jónsdóttir", true)
        under {
            ConversationScreen(
                ConversationViewModel.State(
                    conversation =
                        Conversation("c1", ConversationState.ACTIVE, null, null, listOf(anna), null, 0u, null, Mute.Off),
                    loaded = true,
                    draft = "Sæl",
                ),
                nothing<ConversationActions>(),
            )
        }
        each {
            compose.onNodeWithContentDescription(text(R.string.send)).assertIsEnabled()
            compose.onNode(hasSetText).assertIsEnabled()
        }
    }
}

private val hasSetText = SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText)
