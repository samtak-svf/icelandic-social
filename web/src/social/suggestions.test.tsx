import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Profile } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { SuggestionsView } from "./suggestions.tsx";
import { shownSuggestions, suggestionPage } from "./suggestions.ts";
import { append } from "./paged.ts";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

const person = (id: string): Profile => ({
  accountId: id,
  name: `Nafn ${id}`,
  verified: false,
  photo: null,
  photoFrames: null,
});

const none = new Set<string>();
const view = (people: Profile[]) =>
  renderToStaticMarkup(<SuggestionsView people={people} busy={false} ask={() => undefined} />);

describe("the suggestions section", () => {
  it("draws nothing at all, no heading, when there is nobody", () => {
    expect(view([])).toBe("");
  });

  it("draws the heading and an add-friend action for each person", () => {
    const html = view([person("a"), person("b")]);
    expect(html).toContain(strings.friends_suggested);
    expect(html.match(new RegExp(strings.person_add_friend, "gu"))).toHaveLength(2);
  });

  it("drops a person who was asked", () => {
    const shown = shownSuggestions(true, [person("a"), person("b")], new Set(["a"]));
    expect(shown.map((p) => p.accountId)).toEqual(["b"]);
  });

  it("is absent while the switch is off", () => {
    expect(shownSuggestions(false, [person("a")], none)).toEqual([]);
  });

  it("shows nobody before the first page has answered", () => {
    expect(shownSuggestions(true, null, none)).toEqual([]);
  });
});

describe("suggestionPage", () => {
  it("reads the people as the page and passes the cursor on", async () => {
    const list = vi.fn(() =>
      Promise.resolve({ status: 200 as const, data: { people: [person("a")], next: "c2" } }),
    );
    const result = await suggestionPage(list, "c1");
    expect(list).toHaveBeenCalledWith({ query: { after: "c1" } });
    expect(result).toEqual({ ok: true, data: { posts: [person("a")], next: "c2" } });
  });

  it("asks for the first page with no cursor", async () => {
    const list = vi.fn(() =>
      Promise.resolve({ status: 200 as const, data: { people: [], next: null } }),
    );
    await suggestionPage(list, undefined);
    expect(list).toHaveBeenCalledWith({ query: {} });
  });

  it("turns a failed read into a problem and throws nothing", async () => {
    const result = await suggestionPage(() => Promise.reject(new Error("offline")), undefined);
    expect(result.ok).toBe(false);
  });

  it("adds a second page after the first", () => {
    const held = { items: [person("a")], next: "c2" };
    const merged = append(held, { items: [person("b")], next: null }, (p) => p.accountId);
    expect(merged.items.map((p) => p.accountId)).toEqual(["a", "b"]);
    expect(merged.next).toBeNull();
  });
});
