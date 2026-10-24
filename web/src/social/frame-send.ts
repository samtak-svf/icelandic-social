import {
  getCommunityAvatarSource,
  getCommunityCoverSource,
  getPhotoSource,
  setCommunityAvatar,
  setCommunityAvatarFrames,
  setCommunityCover,
  setCommunityCoverFrames,
  setPhoto,
  setPhotoFrames,
} from "../generated/api.ts";
import type { Framing } from "../generated/frames.ts";
import type { Problem } from "../problem.ts";
import { outcome, type Outcome } from "./outcome.ts";

// The three images that are framed (decision 0086) and the calls that send
// them: the master as it was chosen, then the framing the person made.

/** Whose image it is: the account's photo, or a community's picture or cover. */
export type Target =
  | { kind: "account" }
  | { kind: "picture"; communityId: string }
  | { kind: "cover"; communityId: string };

/** What can go wrong with an image, beyond a problem the API names. */
export type SendProblem = Problem | "too_large" | "invalid_image" | "no_master";

/** The status of a refusal as the sentence it is. */
function refusal(done: Outcome<unknown>): SendProblem | null {
  if (done.ok) return null;
  if (done.status === 400) return "invalid_image";
  if (done.status === 413) return "too_large";
  if (done.status === 409 || done.status === 404) return "no_master";
  return done.problem;
}

/** Sends the master; the problem, or null when it went. */
async function putMaster(target: Target, body: Blob): Promise<SendProblem | null> {
  let done;
  switch (target.kind) {
    case "account":
      done = await outcome(setPhoto({ body }), 200);
      break;
    case "picture":
      done = await outcome(
        setCommunityAvatar({ path: { communityId: target.communityId }, body }),
        200,
      );
      break;
    case "cover":
      done = await outcome(
        setCommunityCover({ path: { communityId: target.communityId }, body }),
        200,
      );
      break;
  }
  // A 404 here is a missing community, not a missing master.
  if (!done.ok && done.status === 404) return done.problem;
  return refusal(done);
}

/** Sends the framing of an image that has a master; the problem, or null when it went. */
export async function putFrames(target: Target, body: Framing): Promise<SendProblem | null> {
  let done;
  switch (target.kind) {
    case "account":
      done = await outcome(setPhotoFrames({ body }), 200);
      break;
    case "picture":
      done = await outcome(
        setCommunityAvatarFrames({ path: { communityId: target.communityId }, body }),
        200,
      );
      break;
    case "cover":
      done = await outcome(
        setCommunityCoverFrames({ path: { communityId: target.communityId }, body }),
        200,
      );
      break;
  }
  return refusal(done);
}

/** The stored master, to frame it again; "no_master" for an image from before decision 0086. */
export async function getMaster(target: Target): Promise<Blob | SendProblem> {
  let done;
  switch (target.kind) {
    case "account":
      done = await outcome(getPhotoSource(), 200);
      break;
    case "picture":
      done = await outcome(
        getCommunityAvatarSource({ path: { communityId: target.communityId } }),
        200,
      );
      break;
    case "cover":
      done = await outcome(
        getCommunityCoverSource({ path: { communityId: target.communityId } }),
        200,
      );
      break;
  }
  if (done.ok) return done.data;
  if (done.status === 404) return "no_master";
  return done.problem;
}

/** Sends the master, then the framing when the person made one. */
export async function putFramed(
  target: Target,
  master: Blob,
  framing: Framing | null,
): Promise<SendProblem | null> {
  const sent = await putMaster(target, master);
  if (sent !== null || framing === null) return sent;
  return putFrames(target, framing);
}
