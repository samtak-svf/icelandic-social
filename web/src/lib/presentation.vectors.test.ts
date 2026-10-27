import { afterAll, describe, expect, it } from "vitest";
import vectors from "../../../api/presentation.vectors.json" with { type: "json" };
import { strings } from "../generated/brand/strings.ts";
import { describe as describeProblem, refused } from "../problem.ts";
import { initials } from "../social/avatar.tsx";
import { listStamp } from "./is-format.ts";
import { noticeText } from "./notice-text.ts";
import { relativeTime } from "./relative-time.ts";

// The shared presentation vectors (#275): Android and iOS read the same file,
// so a rule that drifts on one platform fails there.

/** The brand's sentence for a strings key, with the count a placeholder takes. */
function say(key: string, count?: number): string {
  const text: unknown = Reflect.get(strings, key);
  if (typeof text === "string") return text;
  if (typeof text === "function") return String(Reflect.apply(text, undefined, [{ count }]));
  throw new Error(`no strings key ${key}`);
}

const zone = process.env.TZ;
afterAll(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

describe("the shared relative times", () => {
  process.env.TZ = vectors.zone === "Atlantic/Reykjavik" ? "UTC" : vectors.zone;
  for (const v of vectors.relativeTime) {
    it(`${v.at} from ${v.now}`, () => {
      const want = v.key === null ? v.expected : say(v.key, v.count);
      expect(relativeTime(Date.parse(v.at), Date.parse(v.now))).toBe(want);
    });
  }
});

describe("the shared initials", () => {
  for (const v of vectors.initials) {
    it(JSON.stringify(v.name), () => {
      expect(initials(v.name)).toBe(v.initials);
    });
  }
});

describe("the shared row stamps", () => {
  // Reykjavík is UTC all year, and the web reads the viewer's own clock.
  process.env.TZ = "UTC";
  for (const section of ["stamp", "listStamp"] as const) {
    for (const v of vectors[section]) {
      it(`${section} ${v.at} from ${v.now}`, () => {
        expect(listStamp(Date.parse(v.at), Date.parse(v.now), strings.day_yesterday)).toBe(
          v.expected,
        );
      });
    }
  }
});

describe("the shared problem text", () => {
  for (const v of vectors.problem) {
    it(`${v.outcome} ${v.status ?? ""} ${v.code ?? ""}`, () => {
      const problem =
        v.outcome === "unreachable"
          ? ({ kind: "unreachable" } as const)
          : refused(v.code === null ? "Bad Gateway" : { error: v.code, requestId: "r1" });
      expect(describeProblem(problem).message).toBe(say(v.key));
    });
  }
});

const KINDS = ["comment", "reply", "reaction", "join_approved", "moderated"] as const;
function kindOf(kind: string): (typeof KINDS)[number] {
  const found = KINDS.find((k) => k === kind);
  if (found === undefined) throw new Error(`no notification kind ${kind}`);
  return found;
}

describe("the shared notification sentences", () => {
  for (const v of vectors.notice) {
    it(`${v.kind} ${v.action ?? ""} ${v.actorCount} -> ${v.key}`, () => {
      const got = noticeText({
        kind: kindOf(v.kind),
        action: v.action ?? null,
        actors: v.actors.map((name) => (name === null ? null : { name })),
        actorCount: v.actorCount,
      });
      expect(got.key).toBe(v.key);
      expect(got.args).toEqual(v.args);
      expect(got.badge).toBe(v.badge);
      const name = (arg: string | null | undefined) => arg ?? strings.person_deleted;
      const args: Record<string, string | number> = { name: name(v.args.name) };
      if (v.args.other !== undefined) args.other = name(v.args.other);
      if (v.args.count !== undefined) args.count = v.args.count;
      const text: unknown = Reflect.get(strings, v.key);
      expect(got.text).toBe(
        typeof text === "function" ? String(Reflect.apply(text, undefined, [args])) : text,
      );
    });
  }
});
