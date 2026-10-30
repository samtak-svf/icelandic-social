package samtak.spjall.ui

import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.layout.PaneScaffoldDirective
import androidx.compose.material3.adaptive.layout.calculatePaneScaffoldDirective
import androidx.compose.runtime.Composable
import samtak.spjall.core.Frame
import samtak.spjall.core.FrameKind
import samtak.spjall.frames.CoreFrameRules
import samtak.spjall.frames.FrameRules
import samtak.spjall.frames.LocalFrameRules
import samtak.spjall.frames.windowWidthDp

/** How the five places are reached: a bar along the bottom, or a rail down the left. */
enum class Navigation { BAR, RAIL }

/** The community page: one column, or the feed with `community_info` beside it. */
enum class CommunityLayout { COLUMN, FEED_AND_ASIDE }

/** Stjórna: one screen of buttons, or a side navigation with a page for each part. */
enum class ManageLayout { ONE_SCREEN, SIDE_NAV }

/** The featured posts: a row between the composer and the feed, or in the aside (0088). */
enum class FeaturedLayout { STRIP, ASIDE }

/** The hub: Nýjast, `communities_tab_mine` and Finna as tabs, or the communities in a column beside the feed. */
enum class HubLayout { TABS, COLUMN }

/** `community_create`: the form alone, or the form beside a live preview of the community's header. */
enum class CreateLayout { FORM, FORM_AND_PREVIEW }

/** The community's tab row: it scrolls sideways when it does not fit, or lies in one row (0089). */
enum class TabsLayout { SCROLL, ROW }

/**
 * What each size class lays out (decision 0087), the one map from a window to a layout; the same eight fields, with
 * the same values, as the web's `LAYOUTS` (`web/src/ui/layout.ts`). The screens read this and never a width, and the
 * tests read it to know what to expect.
 */
data class Layout(
    val navigation: Navigation,
    val community: CommunityLayout,
    /** How many members' pictures the community header or aside shows at most. */
    val memberPictures: Int,
    val manage: ManageLayout,
    val featured: FeaturedLayout,
    val hub: HubLayout,
    val create: CreateLayout,
    val tabs: TabsLayout,
)

private val COMPACT_LAYOUT =
    Layout(
        navigation = Navigation.BAR,
        community = CommunityLayout.COLUMN,
        memberPictures = 5,
        manage = ManageLayout.ONE_SCREEN,
        featured = FeaturedLayout.STRIP,
        hub = HubLayout.TABS,
        create = CreateLayout.FORM,
        tabs = TabsLayout.SCROLL,
    )

private val MEDIUM_LAYOUT =
    COMPACT_LAYOUT.copy(navigation = Navigation.RAIL, memberPictures = 12, tabs = TabsLayout.ROW)

private val EXPANDED_LAYOUT =
    MEDIUM_LAYOUT.copy(
        community = CommunityLayout.FEED_AND_ASIDE,
        manage = ManageLayout.SIDE_NAV,
        featured = FeaturedLayout.ASIDE,
        hub = HubLayout.COLUMN,
        create = CreateLayout.FORM_AND_PREVIEW,
    )

/**
 * The size class of a window [widthDp] dp wide. It is the core's answer for a cover (the breakpoints of 0086 are
 * the layout's breakpoints), so no width is typed here.
 */
fun windowClassOf(
    widthDp: Int,
    rules: FrameRules = CoreFrameRules,
): Frame = rules.frameForWidth(FrameKind.COVER, widthDp)

/** The layout of a window of size class [window]. */
fun layoutOf(window: Frame): Layout =
    when (window) {
        Frame.COMPACT, Frame.SQUARE -> COMPACT_LAYOUT
        Frame.MEDIUM -> MEDIUM_LAYOUT
        Frame.EXPANDED -> EXPANDED_LAYOUT
    }

/** The widest a column of content is drawn, so a line of text stays readable: 42rem less the web's padding (0087). */
const val CONTENT_WIDTH = 640

/** The layout of the window being drawn in; it follows a rotation, a resize and an unfolding. */
@Composable
fun currentLayout(): Layout = layoutOf(windowClassOf(windowWidthDp(), LocalFrameRules.current))

/**
 * The directive of a two-pane scaffold, which is composed only when [currentLayout] is expanded: always two panes
 * side by side, so the library's own breakpoints never decide a layout the core's size class has already decided.
 */
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
@Composable
internal fun sideBySide(): PaneScaffoldDirective =
    calculatePaneScaffoldDirective(currentWindowAdaptiveInfo()).copy(maxHorizontalPartitions = 2)
