import { useEffect, useState, useSyncExternalStore } from "react";
import type { Conversation, CoreEvent } from "../generated/core.d.ts";
import { useObjectUrl } from "../social/object-url.ts";
import { useChat } from "./chat.tsx";
import { isFailure } from "./protocol.ts";
import { isGroup } from "./people.ts";

// A group's photo on the page (decision 0094): the bytes live in the core's
// store, so the page asks the worker for them and shows them from an object
// URL. One hook serves the row, the header and the info page.

/**
 * The envelope id of the latest photo change seen per conversation. A replace
 * keeps the same `photo` path (the core overwrites its one local copy), so the
 * path alone cannot tell a new picture from the old one: this revision is what
 * changes. It is an id, not a counter, so every hook instance that notes the
 * same change agrees on the same value.
 */
const revisions = new Map<string, string>();
const watchers = new Set<() => void>();

/** Records that the photo of `conversation` changed with envelope `envelopeId`. */
export function noteGroupPhoto(conversation: string, envelopeId: string): void {
  if (revisions.get(conversation) === envelopeId) return;
  revisions.set(conversation, envelopeId);
  for (const watch of watchers) watch();
}

function watchRevisions(watch: () => void): () => void {
  watchers.add(watch);
  return () => void watchers.delete(watch);
}

/** The photo change a batch of core events carries for `conversation`, if any. */
export function photoChange(events: CoreEvent[]): { conversation: string; id: string } | null {
  for (const e of events) {
    if (e.kind === "message" && e.message.envelope.body.kind === "photo") {
      return { conversation: e.message.conversation, id: e.message.envelope.id };
    }
  }
  return null;
}

/** What the picture is fetched under: the path and the revision, or null when there is none to fetch. */
export function photoKey(path: string | null, revision: string | null): string | null {
  return path === null ? null : `${path}#${revision ?? ""}`;
}

/** Whether a failed change was an image the core could not read (no retry helps) or anything else. */
export function groupPhotoProblem(error: unknown): "unsupported" | "failed" {
  return isFailure(error) && error.code === "unsupported-image" ? "unsupported" : "failed";
}

/**
 * An object URL for the group's photo, or null for a 1:1 (which shows the
 * other person's photo), a group without one, or while it loads.
 */
export function useGroupPhoto(conversation: Conversation | null): string | null {
  const { call, subscribe } = useChat();
  const id = conversation?.id ?? null;
  const revision = useSyncExternalStore(
    watchRevisions,
    () => (id === null ? null : (revisions.get(id) ?? null)),
    () => null,
  );
  // A photo change that reached this device from another member.
  useEffect(
    () =>
      subscribe((events) => {
        const change = photoChange(events);
        if (change !== null) noteGroupPhoto(change.conversation, change.id);
      }),
    [subscribe],
  );
  const path = conversation !== null && isGroup(conversation) ? conversation.photo : null;
  const key = photoKey(path, revision);
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let live = true;
    const fetching =
      key === null || call === undefined || id === null ? null : call("groupPhoto", id);
    if (fetching === null) setBlob(null);
    void fetching?.then(
      (bytes) => {
        if (live)
          setBlob(
            bytes === null ? null : new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
          );
      },
      () => {
        if (live) setBlob(null);
      },
    );
    return () => {
      live = false;
    };
  }, [call, id, key]);
  return useObjectUrl(blob);
}
