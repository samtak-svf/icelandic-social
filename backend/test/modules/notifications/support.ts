import { env } from "cloudflare:workers";
import { runJobs } from "../../../src/modules/jobs/index.ts";
import { jobHandlers } from "../../../src/modules/notifications/index.ts";
import { community, ok, person, type Person } from "../../people.ts";
import { euEnv } from "../../support.ts";

// Shared by the notification tests: a push sender that records, the cron run,
// the inbox as the app reads it, and a community with one post.

export type Push = { send: (p: { deviceId: string }) => Promise<void> };

/** A push sender that records the devices it was asked to push. */
export function recorder() {
  const sent: string[] = [];
  return { sent, send: async ({ deviceId }: { deviceId: string }) => void sent.push(deviceId) };
}

/** Runs the jobs due now with `push`. */
export const run = (push: Push, at = Date.now() + 1) => runJobs(euEnv(env), jobHandlers(push), at);

type Author = { accountId: string };

type Row = {
  notificationId: string;
  kind: string;
  actor: Author | null;
  actors: Author[];
  actorCount: number;
  communityId: string | null;
  postId: string | null;
  commentId: string | null;
  action: string | null;
  emoji: string | null;
  createdAt: number;
  read: boolean;
  announce: boolean;
  snippet: string | null;
};

export type Page = {
  notifications: Row[];
  unread: number;
  unseen: number;
  seenAt: number | null;
  next: string | null;
};

export const inbox = async (one: Person) => ok<Page>(await one.call("GET", "/v1/notifications"));

/** A community with `author`, who made a post, and `readers`, who joined. */
export async function scene(...names: string[]) {
  const author = await person("Höfundur");
  const readers = await Promise.all(names.map((name) => person(name)));
  const id = await community(author, "open", ...readers);
  const { postId } = await ok<{ postId: string }>(
    await author.call("POST", `/v1/communities/${id}/posts`, { body: "Póstur" }),
  );
  return { author, readers, id, postId };
}

/** Waits out a millisecond, so two notifications never share a creation time. */
export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 3));
