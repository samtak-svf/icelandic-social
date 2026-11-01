import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  ImportConnection,
  ImportItem,
  ImportPageConnection,
  ImportStatus,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Paged } from "../social/paged.ts";
import { validateImportsSearch, PageRow } from "./page-section.tsx";
import {
  ChoiceView,
  dayEnd,
  dayStart,
  inChoice,
  MOST_EXCLUDED,
  stateSentence,
  type Choice,
} from "./preview.tsx";
import { lostLines } from "./classes.tsx";
import { ConnectionRow, connectionSentence } from "./profile-section.tsx";
import { EarlierList } from "./screen.tsx";
import { failureSentence, ImportProblem } from "./shared.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
  useNavigate: () => () => undefined,
}));

const DAY = Date.parse("2020-03-04T12:00:00.000Z");

const status = (over: Partial<ImportStatus> = {}): ImportStatus => ({
  state: "ready",
  failure: null,
  counts: { posts: 2, images: 1, videos: 1, skipped: 0, earliest: DAY, latest: DAY },
  classes: [
    { class: "own", posts: 2, images: 1, imagesLost: 0, videos: 0 },
    { class: "link", posts: 0, images: 0, imagesLost: 0, videos: 0 },
    { class: "other_timeline", posts: 0, images: 0, imagesLost: 0, videos: 0 },
    { class: "hidden", posts: 0, images: 0, imagesLost: 0, videos: 0 },
  ],
  lost: { videoOnly: 0, foreignOnly: 0, foreignImages: 0, empty: 0 },
  ...over,
});

const item = (over: Partial<ImportItem> = {}): ImportItem => ({
  id: "i1",
  at: DAY,
  text: "Gamall póstur",
  images: 0,
  hasVideo: false,
  class: "own",
  ...over,
});

const paged = (over: Partial<Paged<ImportItem>> = {}): Paged<ImportItem> => ({
  items: [item()],
  problem: null,
  hasMore: false,
  sentinel: () => undefined,
  reload: () => undefined,
  ...over,
});

const choice = (over: Partial<Choice> = {}): Choice => ({
  from: "",
  to: "",
  excluded: new Set(),
  audience: "friends",
  classes: new Set(["own"]),
  ...over,
});

const drawChoice = (list: Paged<ImportItem>, chosen = choice(), s = status()) =>
  renderToStaticMarkup(
    <ChoiceView
      status={s}
      list={list}
      choice={chosen}
      change={() => undefined}
      publish={() => undefined}
    />,
  );

const connection = (over: Partial<ImportConnection> = {}): ImportConnection => ({
  importId: "c1",
  profileUrl: "https://example.org/someone",
  code: "ABC123",
  state: "unproven",
  outcome: null,
  posts: 0,
  lastSyncAt: null,
  ...over,
});

const drawRow = (row: ImportConnection) =>
  renderToStaticMarkup(
    <ConnectionRow row={row} check={() => undefined} remove={() => undefined} />,
  );

describe("the range of days", () => {
  it("runs from the first moment of one day to the last of the other", () => {
    expect(dayStart("2020-03-04")).toBe(Date.parse("2020-03-04T00:00:00.000Z"));
    expect(dayEnd("2020-03-04")).toBe(Date.parse("2020-03-04T23:59:59.999Z"));
  });

  it("leaves out a limit that was not chosen", () => {
    expect(dayStart("")).toBeUndefined();
    expect(dayEnd("")).toBeUndefined();
  });

  it("includes a post on either end day and none outside", () => {
    const items = [
      item({ id: "before", at: Date.parse("2020-03-03T23:59:59.000Z") }),
      item({ id: "first", at: Date.parse("2020-03-04T00:00:00.000Z") }),
      item({ id: "last", at: Date.parse("2020-03-05T23:59:59.000Z") }),
      item({ id: "after", at: Date.parse("2020-03-06T00:00:00.000Z") }),
    ];
    const kept = inChoice(items, choice({ from: "2020-03-04", to: "2020-03-05" }));
    expect(kept.map((row) => row.id)).toEqual(["first", "last"]);
  });
});

describe("the choice of what to publish", () => {
  it("shows the counts, the posts and that nothing lasts unpublished", () => {
    const html = drawChoice(paged());
    expect(html).toContain(strings.imports_class_counts({ posts: "2", images: "1" }));
    expect(html).toContain("Gamall póstur");
    expect(html).toContain(strings.imports_preview_kept);
    expect(html).toContain(strings.imports_publish);
    expect(html).not.toContain(strings.imports_skipped({ count: 1 }));
  });

  it("says what could not be read", () => {
    const counts = { ...status().counts, skipped: 3 };
    expect(drawChoice(paged(), choice(), status({ counts }))).toContain(
      strings.imports_skipped({ count: 3 }),
    );
  });

  it("says a video does not come along, on the post that has one", () => {
    expect(drawChoice(paged({ items: [item({ hasVideo: true })] }))).toContain(
      strings.imports_item_video,
    );
    expect(drawChoice(paged())).not.toContain(strings.imports_item_video);
  });

  it("offers only the kinds of post the file holds, with their counts", () => {
    const html = drawChoice(paged());
    expect(html).toContain(strings.imports_class_own);
    expect(html).not.toContain(strings.imports_class_link);
  });

  it("shows a post only while its kind is chosen, and names a kind other than own", () => {
    const items = [
      item({ id: "mine", text: "Mín orð" }),
      item({ id: "bare", text: "Bara tengill", class: "link" }),
    ];
    const own = drawChoice(paged({ items }));
    expect(own).toContain("Mín orð");
    expect(own).not.toContain("Bara tengill");
    const both = drawChoice(paged({ items }), choice({ classes: new Set(["own", "link"]) }));
    expect(both).toContain("Bara tengill");
    expect(both).toContain(`· ${strings.imports_class_link}`);
  });

  it("cannot publish with no kind chosen, and says so", () => {
    const html = drawChoice(paged(), choice({ classes: new Set() }));
    expect(html).toContain(strings.imports_no_class);
    expect(html).not.toContain(strings.imports_empty_range);
    const off = new RegExp(`<button[^>]* disabled=""[^>]*>${strings.imports_publish}<`);
    expect(html).toMatch(off);
    expect(drawChoice(paged())).not.toMatch(off);
  });

  it("says nothing stays behind when nothing does", () => {
    expect(drawChoice(paged())).not.toContain(strings.imports_lost_heading);
  });

  it("says what stays behind, counting only the kinds chosen", () => {
    const s = status({
      classes: [
        { class: "own", posts: 3, images: 2, imagesLost: 1, videos: 4 },
        { class: "link", posts: 5, images: 0, imagesLost: 50, videos: 60 },
        { class: "other_timeline", posts: 0, images: 0, imagesLost: 0, videos: 0 },
        { class: "hidden", posts: 0, images: 0, imagesLost: 0, videos: 0 },
      ],
      lost: { videoOnly: 115, foreignOnly: 177, foreignImages: 2, empty: 7 },
    });
    expect(lostLines(s, new Set(["own"]))).toEqual([
      strings.imports_lost_videos({ count: 4 }),
      strings.imports_lost_images({ count: 1 }),
      strings.imports_lost_video_only({ count: 115 }),
      strings.imports_lost_foreign_only({ count: 177 }),
      strings.imports_lost_foreign_images({ count: 2 }),
      strings.imports_lost_empty({ count: 7 }),
    ]);
    expect(lostLines(s, new Set(["own", "link"]))[0]).toBe(
      strings.imports_lost_videos({ count: 64 }),
    );
    const html = drawChoice(paged(), choice(), s);
    expect(html).toContain(strings.imports_lost_heading);
    expect(html).toContain(strings.imports_lost_foreign_only({ count: 177 }));
  });

  it("starts on friends, never on everyone", () => {
    expect(drawChoice(paged())).toMatch(/checked=""[^>]*value="friends"/);
  });

  it("says when the range holds nothing, only once everything has been read", () => {
    const narrow = choice({ from: "2021-01-01" });
    expect(drawChoice(paged(), narrow)).toContain(strings.imports_empty_range);
    expect(drawChoice(paged({ hasMore: true }), narrow)).not.toContain(strings.imports_empty_range);
  });

  it("stops leaving posts out at the limit and says why", () => {
    const excluded = new Set(Array.from({ length: MOST_EXCLUDED }, (_, n) => `x${n}`));
    expect(MOST_EXCLUDED).toBe(1000);
    const html = drawChoice(paged(), choice({ excluded }));
    expect(html).toContain(strings.imports_excluded_full);
    expect(html).toMatch(/type="checkbox"[^>]*disabled/);
  });
});

describe("an import that is not waiting for a choice", () => {
  it("has a sentence for every state", () => {
    expect(stateSentence(status({ state: "uploading" }))).toBe(strings.imports_unfinished);
    expect(stateSentence(status({ state: "parsing" }))).toBe(strings.imports_wait_parsing);
    expect(stateSentence(status({ state: "publishing" }))).toBe(strings.imports_wait_publishing);
    expect(stateSentence(status({ state: "removing" }))).toBe(strings.imports_wait_removing);
    expect(stateSentence(status({ state: "done" }))).toBe(strings.imports_done);
    expect(stateSentence(status({ state: "ready" }))).toBeNull();
  });

  it("names each failure the API gives, and one with no reason as out of time", () => {
    const reasons = [
      ["truncated", strings.imports_failed_truncated],
      ["zip64", strings.imports_failed_zip64],
      ["encrypted", strings.imports_failed_encrypted],
      ["unsupported", strings.imports_failed_unsupported],
      ["too_big", strings.imports_failed_too_big],
      ["corrupt", strings.imports_failed_corrupt],
      ["no_posts", strings.imports_failed_no_posts],
      ["outdated", strings.imports_failed_outdated],
    ] as const;
    for (const [code, sentence] of reasons) expect(failureSentence(code)).toBe(sentence);
    expect(failureSentence(null)).toBe(strings.imports_failed_expired);
    expect(failureSentence("something_new")).toBe(strings.imports_failed_expired);
  });
});

describe("a connected profile", () => {
  it("shows the code and the way to check it until it is found", () => {
    const html = drawRow(connection());
    expect(html).toContain("ABC123");
    expect(html).toContain(strings.imports_profile_check);
    expect(html).toContain(strings.imports_disconnect);
  });

  it("says the code was not found", () => {
    expect(connectionSentence(connection({ outcome: "not_found" }))).toBe(
      strings.imports_profile_not_found,
    );
  });

  it("links on to the first collection", () => {
    const html = drawRow(connection({ code: null, state: "preview", outcome: "ok" }));
    expect(html).toContain(strings.imports_preview_link);
    expect(html).not.toContain(strings.imports_profile_check);
  });

  it("says fetching is put off, not that it failed, at the spending limit", () => {
    const row = connection({ code: null, state: "connected", outcome: "capped" });
    expect(connectionSentence(row)).toBe(strings.imports_sync_capped);
  });

  it("counts what has come in and says when it last fetched", () => {
    const html = drawRow(
      connection({ code: null, state: "connected", outcome: "ok", posts: 4, lastSyncAt: DAY }),
    );
    expect(html).toContain(strings.imports_sync_posts({ count: 4 }));
    expect(connectionSentence(connection({ code: null, state: "connected", outcome: "ok" }))).toBe(
      null,
    );
  });
});

describe("a connected page", () => {
  const page: ImportPageConnection = {
    importId: "p1",
    pageId: "1",
    pageName: "Síðan",
    state: "connected",
    outcome: "ok",
    posts: 1,
    lastSyncAt: null,
  };

  it("asks for a new sign-in when the old one ran out", () => {
    const html = renderToStaticMarkup(
      <PageRow row={{ ...page, outcome: "expired" }} remove={() => undefined} />,
    );
    expect(html).toContain(strings.imports_page_expired);
    expect(html).toContain("/auth/page/start");
  });

  it("does not when it holds", () => {
    const html = renderToStaticMarkup(<PageRow row={page} remove={() => undefined} />);
    expect(html).not.toContain(strings.imports_page_expired);
  });
});

describe("the address after signing in", () => {
  it("keeps the answers the server gives and drops anything else", () => {
    expect(validateImportsSearch({ page: "declined" })).toEqual({ page: "declined" });
    expect(validateImportsSearch({ page: "<script>" })).toEqual({});
    expect(validateImportsSearch({})).toEqual({});
  });
});

describe("the earlier files", () => {
  it("draws nothing with none", () => {
    expect(renderToStaticMarkup(<EarlierList imports={[]} />)).toBe("");
  });

  it("gives each one's state", () => {
    const row = { ...status({ state: "done" }), importId: "f1", createdAt: DAY };
    const html = renderToStaticMarkup(<EarlierList imports={[row]} />);
    expect(html).toContain(strings.imports_earlier_title);
    expect(html).toContain(strings.imports_state_done);
  });
});

describe("a refusal", () => {
  const refusal = (code: string) => ({ kind: "refused", code, requestId: null }) as const;

  it("uses the sentence named for its code", () => {
    const html = renderToStaticMarkup(
      <ImportProblem
        problem={refusal("too_large")}
        names={{ too_large: strings.imports_file_too_large }}
      />,
    );
    expect(html).toContain(strings.imports_file_too_large);
  });

  it("says to wait when there were too many tries, on every section", () => {
    expect(renderToStaticMarkup(<ImportProblem problem={refusal("rate_limited")} />)).toContain(
      strings.imports_rate_limited,
    );
  });

  it("falls back to the general sentence", () => {
    expect(renderToStaticMarkup(<ImportProblem problem={refusal("other")} />)).toContain(
      strings.error_generic,
    );
  });
});
