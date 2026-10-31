# 0121. The app's own links open in the app

- Status: accepted; designed, not yet implemented (#473)
- Date: 2026-10-31
- Decided by: Guðröður Atli Jónsson, after showing on a phone that a post link and a community
  link in a message open the web app in the browser
- Amends: [0046](0046-copy-a-message-and-open-its-links.md) (links open in the default browser)

## Decision

**A link to the app's own post or community opens that screen in the app.** On Android and iOS,
an address on the frozen host from `identifiers/ids.json` with the path `/posts/<id>` or
`/communities/<id>` goes to the native screen, with back returning to where the reader was. The
screen reader's "Opna" action on a link (0046) takes the same route.

**Every other link still opens in the default browser, exactly as 0046 says.** That covers other
hosts, look-alike hosts, and other paths on our own host. 0046's reasons hold for them: the
default browser keeps the reader's own sign-ins and settings, and is one less surface to keep
safe.

**A link opened from outside the app does the same, once the host proves the app.** That needs the
two prefixes claimed in the Android manifest and in `apple-app-site-association`, and the store
signing fingerprint published in `assetlinks.json`. Until then, such a link opens in the browser,
as it does now.

**A post or community the reader may not see shows the screen's own not-found state.** The route
checks nothing itself: the server already decides what a reader may see.

**The web app does not change.** A person without the app gets the web page from the same address.

## Why

The apps mint these addresses themselves, for sharing, and both screens exist natively. Leaving
for a browser on the way to a screen the app already has breaks the reader's place, and in the
browser they may not be signed in at all. 0046 was written about links to the wider web and did
not separate this case.

## What this rules out

- A WebView or an in-app browser tab. 0046 still rules them out, for every link.
- Opening other sites' links in the app.
- Claiming the whole host. The web app serves other pages there, and those must keep opening in
  the browser.
