import { brandStrings } from "../../brand.gen.ts";
import { androidTesterGroup, assistantCommunity, assistantModel, db } from "../../env/index.ts";
import { assistantAccount } from "../../identity/index.ts";
import { log } from "../../log.ts";
import { type Said, thread, writeComment } from "../social/index.ts";
import { maskAddresses, parseAddress, platformOf } from "./address.ts";
import type { Model } from "./model.ts";
import { recordCall, recordRefusal, usage } from "./usage.ts";

// The assistant job's handler (decision 0076): a post or comment in the
// assistant's community queues the address it gives, then the model may answer
// it. The queueing is the parser's alone, so what the model writes adds no
// one. An answered post or comment is recorded with the answer, so a job run
// twice posts one answer.

/** What an address is replaced with before a thread reaches the model. */
const MASK = "[netfang]";

/** Queues the address `text` gives, unless it is already queued. Whether one was found. */
async function queue(
  env: Env,
  accountId: string,
  saidId: string,
  text: string,
  platform: "ios" | "android",
): Promise<boolean> {
  const address = parseAddress(text);
  // An Android tester joins the group themselves when there is one.
  if (!address || (platform === "android" && androidTesterGroup(env))) return false;
  await db(env)
    .prepare(
      `INSERT INTO tester_requests (request_id, platform, address, account_id, comment_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .bind(`tr_${crypto.randomUUID()}`, platform, address, accountId, saidId, Date.now())
    .run();
  return true;
}

/** The system prompt, with the Android steps as they stand. */
function systemPrompt(env: Env): string {
  const group = androidTesterGroup(env);
  const android = group
    ? brandStrings.assistant_android_group.replace("{group_url}", () => group)
    : brandStrings.assistant_android_manual;
  return brandStrings.assistant_prompt.replace("{android}", () => android);
}

/** The handler of the assistant job, answering with `model`. */
export function answerHandler(model: Model) {
  return async (env: Env, _key: string, payload: Record<string, unknown>): Promise<void> => {
    // A job queued before posts woke the assistant names a comment.
    const saidId = String(payload.saidId ?? payload.commentId);
    const communityId = assistantCommunity(env);
    const assistant = await assistantAccount(env);
    if (!communityId || !assistant) return;
    const found = await thread(env, communityId, saidId, assistant);
    if (!found) return;
    const { said, post, comments } = found;
    if (said.author === assistant || !said.visible) return;

    const own = comments.filter((c) => c.author === said.author).map((c) => c.body);
    const platform = platformOf([...own, said.body]);
    const queued = await queue(env, said.author, saidId, said.body, platform);

    const answered = await db(env)
      .prepare("SELECT 1 FROM assistant_answers WHERE comment_id = ?")
      .bind(saidId)
      .first();
    if (answered) return;
    const key = assistantModel(env);
    if (!key) return;
    const spent = await usage(env);
    if (spent.costMicroUsd >= key.capMicroUsd) {
      await recordRefusal(env);
      log("assistant.over_cap", { communityId, count: spent.calls });
      return;
    }

    const answer = await model(
      key.apiKey,
      systemPrompt(env),
      describe(post, comments, said, assistant, queued),
    );
    await recordCall(env, answer.inputTokens, answer.outputTokens);
    const text = answer.text;
    if (!answer.complete || !text || text === brandStrings.assistant_silence) {
      log("assistant.silent", { communityId, postId: post.postId });
      return;
    }
    const written = await writeComment(env, assistant, post.postId, text, () => [
      db(env)
        .prepare(
          "INSERT INTO assistant_answers (comment_id, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING",
        )
        .bind(saidId, Date.now()),
    ]);
    log("assistant.answered", {
      communityId,
      postId: post.postId,
      code: written && "comment" in written ? "posted" : "refused",
    });
  };
}

type Written = { author: string; body: string };

/** The thread as the model reads it: no names and no addresses, only who is who. */
function describe(
  post: Written & { postId: string },
  comments: (Written & { commentId: string })[],
  answering: Said,
  assistant: string,
  queued: boolean,
): string {
  const testers = new Map<string, number>();
  const who = (author: string) => {
    if (author === assistant) return "the assistant (you)";
    if (!testers.has(author)) testers.set(author, testers.size + 1);
    return `tester ${testers.get(author)}`;
  };
  // The post's author is named only when the post is what the model answers.
  const heading =
    post.postId === answering.id
      ? `The post, by ${who(post.author)} [ANSWER THIS ONE]`
      : "The post";
  const lines = [
    `${heading}:\n${maskAddresses(post.body, MASK)}`,
    "",
    "Its comments, oldest first:",
  ];
  for (const c of comments) {
    const mark = c.commentId === answering.id ? " [ANSWER THIS ONE]" : "";
    lines.push(`- ${who(c.author)}${mark}: ${maskAddresses(c.body, MASK)}`);
  }
  if (post.postId !== answering.id && !comments.some((c) => c.commentId === answering.id)) {
    lines.push(
      `- ${who(answering.author)} [ANSWER THIS ONE]: ${maskAddresses(answering.body, MASK)}`,
    );
  }
  lines.push(
    "",
    queued
      ? "An address was found in what you answer and has been queued."
      : "No address was found in what you answer.",
  );
  return lines.join("\n");
}
