import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ModerationReview, ModerationStatement } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Paged } from "./paged.ts";
import { reviewSentence, StatementCard, StatementsView } from "./statements.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

const statement = (over: Partial<ModerationStatement> = {}): ModerationStatement => ({
  entryId: 3,
  action: "remove_post",
  target: { kind: "post", id: "p1" },
  communityId: "c1",
  reason: "Brot á reglum",
  createdAt: 1_700_000_000_000,
  body: "Textinn minn",
  canAsk: true,
  review: null,
  ...over,
});

const review = (over: Partial<ModerationReview> = {}): ModerationReview => ({
  state: "open",
  askedAt: 1_700_000_100_000,
  decidedAt: null,
  reason: null,
  restored: false,
  ...over,
});

const draw = (s: ModerationStatement) =>
  renderToStaticMarkup(<StatementCard statement={s} asked={() => undefined} />);

const paged = (over: Partial<Paged<ModerationStatement>>): Paged<ModerationStatement> => ({
  items: null,
  problem: null,
  hasMore: false,
  sentinel: () => undefined,
  reload: () => undefined,
  ...over,
});

describe("a statement of reasons", () => {
  it("tells which item, why, and that the review can be asked for once", () => {
    const html = draw(statement());
    expect(html).toContain(strings.moderation_decision_remove_post);
    expect(html).toContain("Brot á reglum");
    expect(html).toContain("Textinn minn");
    expect(html).toContain(strings.statement_ask_once);
    expect(html).toContain(strings.statement_ask);
  });

  it("says the text is gone after its 90 days", () => {
    expect(draw(statement({ body: null }))).toContain(strings.statement_text_gone);
  });

  it("does not claim purged text for a photo, which has none", () => {
    const html = draw(
      statement({
        action: "clear_account_photo",
        target: { kind: "account", id: "a1" },
        communityId: null,
        body: null,
      }),
    );
    expect(html).toContain(strings.moderation_decision_clear_account_photo);
    expect(html).not.toContain(strings.statement_text_gone);
  });

  it("offers no second request", () => {
    const html = draw(statement({ canAsk: false, review: review() }));
    expect(html).toContain(strings.statement_review_open);
    expect(html).not.toContain(strings.statement_ask_once);
  });

  it("shows the answer and the decider's reason, and never who decided", () => {
    const html = draw(
      statement({
        canAsk: false,
        review: review({ state: "upheld", decidedAt: 1, reason: "Reglurnar eru skýrar" }),
      }),
    );
    expect(html).toContain(strings.statement_review_upheld);
    expect(html).toContain("Reglurnar eru skýrar");
  });

  it("says when an overturned action cannot bring the content back", () => {
    const upheld = review({ state: "upheld" });
    const back = review({ state: "overturned", restored: true });
    const notBack = review({ state: "overturned", restored: false });
    expect(reviewSentence(upheld)).toBe(strings.statement_review_upheld);
    expect(reviewSentence(back)).toBe(strings.statement_review_overturned);
    expect(reviewSentence(notBack)).toBe(strings.statement_review_overturned_not_restored);
  });
});

describe("the list of statements", () => {
  it("says so when there is nothing", () => {
    const html = renderToStaticMarkup(<StatementsView list={paged({ items: [] })} />);
    expect(html).toContain(strings.statements_title);
    expect(html).toContain(strings.statements_empty);
  });

  it("shows a refusal instead of an empty list", () => {
    const html = renderToStaticMarkup(
      <StatementsView
        list={paged({ problem: { kind: "refused", code: "not_permitted", requestId: null } })}
      />,
    );
    expect(html).toContain(strings.problem_not_permitted);
    expect(html).not.toContain(strings.statements_empty);
  });
});
