import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { strings } from "../generated/brand/strings.ts";
import { LevelSelect, levelsFor } from "./notification-level.tsx";

describe("levelsFor", () => {
  it("offers every level, except that a moderator's action is never off", () => {
    expect(levelsFor("comment")).toEqual(["push", "in_app", "off"]);
    expect(levelsFor("moderated")).toEqual(["push", "in_app"]);
  });
});

describe("LevelSelect", () => {
  it("names itself, lists the levels in the brand's words and selects the current one", () => {
    const html = renderToStaticMarkup(
      <LevelSelect
        label="Athugasemdir"
        value="in_app"
        levels={levelsFor("moderated")}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain("Athugasemdir");
    expect(html).toContain(strings.notification_level_push);
    expect(html).toContain(`selected="">${strings.notification_level_in_app}`);
    expect(html).not.toContain(strings.notification_level_off);
  });
});
