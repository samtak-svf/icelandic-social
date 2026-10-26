import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import type { Poll, Post } from "../generated/api.ts";
import { PollCard, share, showsResults } from "./poll.tsx";
import { POLL_MAX_OPTIONS, canPublishPoll, emptyPoll, pollOptions } from "./poll-draft.ts";

// Server render: the card's first paint from the API's answer. Clicking is e2e/.
const poll = (over: Partial<Poll> = {}): Poll => ({
  options: [
    { optionId: "o0", text: "Já", votes: null },
    { optionId: "o1", text: "Nei", votes: null },
  ],
  total: 4,
  mine: null,
  closed: false,
  ...over,
});
const post = (p: Poll): Post => ({
  postId: "p1",
  communityId: "cm1",
  author: { accountId: "a1", name: "Höfundur", verified: false, photo: null, role: null },
  anonymous: false,
  mine: false,
  body: "Á að funda?",
  media: [],
  createdAt: 1,
  reactions: [],
  myReaction: null,
  emojis: [],
  myEmoji: "",
  commentCount: 0,
  latestComment: null,
  state: "visible",
  pinned: false,
  poll: p,
});

describe("poll card", () => {
  it("shows only the total before the reader has voted", () => {
    const html = renderToStaticMarkup(<PollCard post={post(poll())} />);
    expect(html).toContain("Já");
    expect(html).toContain(strings.poll_votes({ count: 4 }));
    expect(html).not.toContain("data-bar");
    expect(html).not.toContain("%");
    expect(html).not.toContain(strings.poll_withdraw);
  });

  it("shows counts, shares and the reader's own choice after voting", () => {
    const html = renderToStaticMarkup(
      <PollCard
        post={post(
          poll({
            mine: "o1",
            options: [
              { optionId: "o0", text: "Já", votes: 1 },
              { optionId: "o1", text: "Nei", votes: 3 },
            ],
          }),
        )}
      />,
    );
    expect(html).toContain("1 · 25 %");
    expect(html).toContain("3 · 75 %");
    expect(html).toContain(strings.poll_your_choice);
    expect(html).toContain(strings.poll_withdraw);
    expect(html).toContain('aria-checked="true"');
  });

  it("shows final results and the closed label once closed, with no way to change", () => {
    const html = renderToStaticMarkup(
      <PollCard
        post={post(
          poll({
            closed: true,
            options: [
              { optionId: "o0", text: "Já", votes: 2 },
              { optionId: "o1", text: "Nei", votes: 2 },
            ],
          }),
        )}
      />,
    );
    expect(html).toContain(strings.poll_closed);
    expect(html).toContain("2 · 50 %");
    expect(html).not.toContain(strings.poll_withdraw);
    expect(html).toContain("disabled");
  });

  it("draws nothing for a post that is not a poll", () => {
    const { poll: _unused, ...plain } = post(poll());
    expect(renderToStaticMarkup(<PollCard post={plain} />)).toBe("");
  });

  it("measures shares", () => {
    expect(share(0, 0)).toBe(0);
    expect(share(1, 3)).toBe(33);
    expect(showsResults(poll())).toBe(false);
  });
});

describe("poll draft", () => {
  it("starts with two empty options and trims what is sent", () => {
    expect(emptyPoll()).toEqual(["", ""]);
    expect(pollOptions([" a ", "b "])).toEqual(["a", "b"]);
  });

  it("needs a question and two to six distinct, non-empty options", () => {
    expect(canPublishPoll("Q", ["a", "b"])).toBe(true);
    expect(canPublishPoll("", ["a", "b"])).toBe(false);
    expect(canPublishPoll("Q", ["a", ""])).toBe(false);
    expect(canPublishPoll("Q", ["a", " A "])).toBe(false);
    expect(canPublishPoll("Q", ["a"])).toBe(false);
    expect(
      canPublishPoll(
        "Q",
        Array.from({ length: POLL_MAX_OPTIONS + 1 }, (_, i) => `${i}`),
      ),
    ).toBe(false);
  });
});
