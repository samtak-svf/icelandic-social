import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Content, Item, Person } from "../generated/core.d.ts";
import { runStarts } from "./people.ts";
import { ThreadItems } from "./thread-items.tsx";

const MINUTE = 60_000;
const person = (account: string, name: string): Person => ({
  account,
  name,
  verified: false,
  photo: null,
});
const asa = person("a", "Ása Prófsdóttir");
const bo = person("b", "Bo Prófsson");
const text = (t: string): Content => ({ kind: "text", text: t, replyTo: null });
const item = (sender: Person, at: number, over: Partial<Item> = {}): Item => ({
  seq: at,
  envelopeId: null,
  sender,
  own: false,
  ts: at,
  receivedAt: at,
  status: "sent",
  content: text("hæ"),
  edited: false,
  reactions: [],
  readBy: 0,
  readHere: [],
  expiresAt: null,
  forwarded: false,
  ...over,
});
const count = (html: string, word: string) => html.split(word).length - 1;

describe("a group thread says who said what", () => {
  it("names the sender once per run, and again when another person has spoken", () => {
    const html = renderToStaticMarkup(
      <ThreadItems
        group
        items={[item(asa, 0), item(asa, MINUTE), item(bo, 2 * MINUTE), item(asa, 3 * MINUTE)]}
      />,
    );
    expect(count(html, asa.name ?? "")).toBe(2);
    expect(count(html, bo.name ?? "")).toBe(1);
  });

  it("does not name the reader's own messages", () => {
    const html = renderToStaticMarkup(<ThreadItems group items={[item(asa, 0, { own: true })]} />);
    expect(html).not.toContain(asa.name);
  });

  it("names nobody in a 1:1, which has only the one other person", () => {
    const html = renderToStaticMarkup(<ThreadItems group={false} items={[item(asa, 0)]} />);
    expect(html).not.toContain(asa.name);
  });
});

describe("runStarts groups a thread as the apps do (0022)", () => {
  const card: Content = { kind: "timer", seconds: null };
  it.each<[string, Item[], boolean[]]>([
    ["one sender close together", [item(asa, 0), item(asa, 5 * MINUTE)], [true, false]],
    ["a gap over five minutes", [item(asa, 0), item(asa, 5 * MINUTE + 1)], [true, true]],
    ["another sender", [item(asa, 0), item(bo, 1)], [true, true]],
    [
      "a card between them",
      [item(asa, 0), item(asa, 1, { content: card }), item(asa, 2)],
      [true, false, true],
    ],
    [
      "a clock that goes back, from what is not yet stored",
      [item(asa, MINUTE), item(asa, 0, { receivedAt: null, seq: null })],
      [true, false],
    ],
  ])("%s", (_case, items, starts) => {
    expect(runStarts(items)).toEqual(starts);
  });
});
