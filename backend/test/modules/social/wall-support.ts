import { ok, person, type Person } from "../../people.ts";
import { accept, ask, unfriend } from "../friends/support.ts";

export { unfriend };

export type Audience = "friends" | "everyone";
export type WallPost = {
  postId: string;
  communityId: string;
  body: string;
  wall?: { accountId: string };
  audience?: Audience;
};
export type WallPage = { posts: WallPost[]; next: string | null };

/** A post on `owner`'s own wall. */
export async function wallPost(owner: Person, audience: Audience, body = "á veggnum") {
  return ok<WallPost>(await owner.call("POST", "/v1/wall/posts", { body, audience }));
}

/** `a` and `b` as friends. */
export async function befriend(a: Person, b: Person): Promise<void> {
  await ask(a, b);
  await accept(b, a);
}

/** The people every rule of the matrix is read by, with their relation to `owner`. */
export async function cast() {
  const owner = await person("eigandi");
  const friend = await person("vinur");
  const exFriend = await person("fyrrverandi");
  const stranger = await person("okunnugur");
  const blockedByOwner = await person("utilokadur");
  const blocksOwner = await person("utilokar");
  await befriend(owner, friend);
  await befriend(owner, exFriend);
  await unfriend(owner, exFriend);
  await owner.call("PUT", `/v1/blocks/${blockedByOwner.accountId}`);
  await blocksOwner.call("PUT", `/v1/blocks/${owner.accountId}`);
  return { owner, friend, exFriend, stranger, blockedByOwner, blocksOwner };
}
