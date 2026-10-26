# 0096. A browser link that waits for the phone survives a reload

- Status: accepted; implemented in the link request, its store-key endpoint and the web
  client's link page (#263)
- Date: 2026-10-26
- Decided by: Guðröður Atli Jónsson
- Amends: [0064](0064-non-phone-devices-are-linked-devices.md) (the store's two-part key)

## Decision

- **The server makes a browser's half of the store key when the link request is made**, not
  when the link completes. It keeps the share on the request and hands it, while the request
  waits, only to the session that made it (`GET /v1/devices/link-requests/{linkId}/store-key`).
  Completing the request moves the same share to the new device. A request made by an older
  version has no share, and completing it makes a fresh one.
- **The browser seals its store in two parts from the moment the link begins**, as 0064 says
  for a linked browser, with the share bound to `pending/<linkId>` instead of the device id.
  The sealed record also keeps the link's code and expiry, so a reloaded page shows the same
  code and goes on waiting. On completion the record is sealed again for the device, and the
  pending record is deleted.
- **A reloaded page resumes the link while its code is valid**: it unseals the store with the
  share, opens the core (whose own record of the link persists), and asks the link state
  again. An expired link, or a share the server no longer gives, wipes the store as before.
- **The link page waits through failed checks.** One check runs at a time; a check that fails
  on the way (offline, a busy worker, a page coming back from the background) is asked again,
  and only the code's own end stops the wait. The page checks at once when it becomes visible.
- Ending the session deletes its link requests and with them the share (0064's "ending the
  device or its session destroys it").

## Why

- On a phone's browser the person switches to the app to approve, and the browser often
  discards the page in the background. The page then started over with a new store, and the
  approved link was lost. Checks queued while the page was in the background were also
  answered with a failure that ended the wait, though the phone had approved.
- Making the share with the request keeps 0064's property from the first byte the store
  holds: neither the local key nor the server's part opens the store alone, and a copied
  profile opens nothing without the live session.

## Rules out

- A key kept only in the browser while a link waits, or a store sealed by the local key alone.
- Rekeying the store when the link completes.
- Ending a wait on any failed check rather than on the code's expiry.
