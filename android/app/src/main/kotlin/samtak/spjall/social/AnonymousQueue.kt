package samtak.spjall.social

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import samtak.spjall.account.Problem
import samtak.spjall.account.problem
import samtak.spjall.base.BaseViewModel
import samtak.spjall.base.ScreenState
import samtak.spjall.brand.R
import samtak.spjall.core.CoreException
import samtak.spjall.core.Post
import samtak.spjall.me.Confirm
import samtak.spjall.ui.Palette
import samtak.spjall.ui.ProblemCard
import samtak.spjall.ui.rememberBack

/**
 * The anonymous posts that wait for a moderator in a community that allows them (decision 0091), oldest first.
 * Approving one publishes it, declining one drops it; the list is asked for again after each answer. A moderator may
 * also ask for the author of a waiting post, which the community's log records.
 */
class AnonymousQueueViewModel(
    private val communityId: String,
    private val social: Social,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : BaseViewModel<AnonymousQueueViewModel.State>(State(), io) {
    data class State(
        val posts: List<Post> = emptyList(),
        val loaded: Boolean = false,
        override val busy: Boolean = false,
        /** The authors asked for, by post; an empty name is an account without one. */
        val revealed: Map<String, String> = emptyMap(),
        override val problem: Problem? = null,
    ) : ScreenState<State> {
        override fun busy(on: Boolean): State = copy(busy = on)

        override fun trouble(problem: Problem?): State = copy(problem = problem)

        override fun answered(): State = copy(loaded = true)
    }

    init {
        load()
    }

    fun load() {
        perform(::load) { ask() }
    }

    fun approve(postId: String) {
        perform({ approve(postId) }) { ask { social.approveAnonymousPost(postId) } }
    }

    fun decline(postId: String) {
        perform({ decline(postId) }) { ask { social.declineAnonymousPost(postId) } }
    }

    fun reveal(postId: String) {
        if (current.busy) return
        edit { it.busy(true).trouble(null) }
        viewModelScope.launch {
            try {
                val author = withContext(io) { social.revealAuthor(postId) }
                edit { it.copy(busy = false, revealed = it.revealed + (postId to author.name.orEmpty())) }
            } catch (e: CoreException) {
                failed = { reveal(postId) }
                edit { it.busy(false).trouble(e.problem()) }
            }
        }
    }

    /** Runs [write], if any, then asks for the list again. */
    private suspend fun ask(write: suspend () -> Unit = {}) {
        val page =
            withContext(io) {
                write()
                social.pendingAnonymousPosts(communityId, null, PAGE)
            }
        edit { it.copy(posts = page.posts, loaded = true) }
    }

    private companion object {
        const val PAGE = 50u
    }
}

/** What the queue asks of the screen around it. */
interface AnonymousQueueActions {
    fun back()

    fun approve(postId: String)

    fun decline(postId: String)

    fun reveal(postId: String)

    fun retry()
}

private fun anonymousQueueActions(
    model: AnonymousQueueViewModel,
    back: () -> Unit,
) = object : AnonymousQueueActions {
    override fun back() = back()

    override fun approve(postId: String) = model.approve(postId)

    override fun decline(postId: String) = model.decline(postId)

    override fun reveal(postId: String) = model.reveal(postId)

    override fun retry() = model.retry()
}

/** Stjórna's approval queue inside the community (an expanded window). */
@Composable
internal fun AnonymousQueuePane(
    communityId: String,
    social: Social,
) {
    val model: AnonymousQueueViewModel =
        viewModel(key = "anonymous-$communityId") { AnonymousQueueViewModel(communityId, social) }
    val state by model.state.collectAsStateWithLifecycle()
    AnonymousQueueBody(state, anonymousQueueActions(model) { })
}

@Composable
internal fun AnonymousQueue(
    communityId: String,
    social: Social,
    nav: NavController,
) {
    val model: AnonymousQueueViewModel =
        viewModel(key = "anonymous-$communityId") { AnonymousQueueViewModel(communityId, social) }
    val state by model.state.collectAsStateWithLifecycle()
    AnonymousQueueScreen(state, anonymousQueueActions(model, rememberBack(nav)))
}

/** The waiting anonymous posts, each with approve, decline and Sýna höfund. */
@Composable
fun AnonymousQueueScreen(
    state: AnonymousQueueViewModel.State,
    actions: AnonymousQueueActions,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = Palette.bg, contentColor = Palette.fg) {
        Column(modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing.only(SUB_SCREEN_SIDES))) {
            SubHeader(stringResource(R.string.anonymous_queue_title), actions::back)
            AnonymousQueueBody(state, actions, Modifier.weight(1f))
        }
    }
}

@Composable
internal fun AnonymousQueueBody(
    state: AnonymousQueueViewModel.State,
    actions: AnonymousQueueActions,
    modifier: Modifier = Modifier,
) {
    Column(modifier) {
        if (state.busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        LazyColumn(
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            state.problem?.let { problem -> item(key = "problem") { ProblemCard(problem) { actions.retry() } } }
            if (state.loaded && state.problem == null && state.posts.isEmpty()) {
                item(key = "empty") { Muted(stringResource(R.string.anonymous_queue_empty)) }
            }
            items(state.posts, key = { it.postId }) { post ->
                QueuedPost(post, state.revealed[post.postId], !state.busy, actions)
            }
        }
    }
}

@Composable
private fun QueuedPost(
    post: Post,
    revealed: String?,
    enabled: Boolean,
    actions: AnonymousQueueActions,
) {
    SocialCard {
        Text(
            post.anonymousBylineRes()?.let { stringResource(it) }.orEmpty(),
            style = MaterialTheme.typography.titleSmall,
        )
        if (post.body.isNotBlank()) Text(post.body, style = MaterialTheme.typography.bodyLarge)
        PostImageGrid(post)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { actions.approve(post.postId) },
                enabled = enabled,
                modifier = Modifier.heightIn(min = 44.dp),
            ) { Text(stringResource(R.string.anonymous_approve)) }
            OutlinedButton(
                onClick = { actions.decline(post.postId) },
                enabled = enabled,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Palette.danger),
                modifier = Modifier.heightIn(min = 44.dp),
            ) { Text(stringResource(R.string.anonymous_decline)) }
        }
        RevealAuthor(revealed, enabled) { actions.reveal(post.postId) }
    }
}

/** Sýna höfund: the button, a confirmation (the log records who asked), then the name. */
@Composable
internal fun RevealAuthor(
    revealed: String?,
    enabled: Boolean = true,
    onReveal: () -> Unit,
) {
    var asking by rememberSaveable { mutableStateOf(false) }
    if (revealed != null) {
        Text(
            stringResource(R.string.anonymous_revealed, revealed.ifEmpty { stringResource(R.string.person_unnamed) }),
            style = MaterialTheme.typography.titleSmall,
        )
    } else {
        OutlinedButton(onClick = { asking = true }, enabled = enabled, modifier = Modifier.heightIn(min = 44.dp)) {
            Text(stringResource(R.string.anonymous_reveal))
        }
    }
    if (asking) {
        Confirm(
            text = stringResource(R.string.anonymous_reveal_confirm),
            confirm = stringResource(R.string.anonymous_reveal),
            onConfirm = {
                asking = false
                onReveal()
            },
            onDismiss = { asking = false },
        )
    }
}
