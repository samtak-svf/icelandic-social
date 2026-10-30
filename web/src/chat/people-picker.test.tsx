import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Profile } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { PeopleChoice } from "./people-picker.tsx";

const profile = (accountId: string, name: string): Profile => ({
  accountId,
  name,
  verified: false,
  photo: null,
  photoFrames: { focus: { x: 0.5, y: 0.5 } },
});
const nop = () => undefined;
function render(over: Partial<Parameters<typeof PeopleChoice>[0]> = {}) {
  return renderToStaticMarkup(
    <PeopleChoice
      people={[profile("a-2", "Siggi"), profile("a-3", "Gunna")]}
      problem={null}
      searching={false}
      query=""
      setQuery={nop}
      taken={new Set(["a-2"])}
      picked={new Set()}
      toggle={nop}
      more={null}
      confirm={nop}
      cancel={nop}
      busy={false}
      failed={null}
      {...over}
    />,
  );
}

describe("the people picker of adding to a group (0078)", () => {
  it("lists the directory, with whoever is in the group already taken", () => {
    const html = render();
    expect(html).toContain(strings.add_people_title);
    expect(html).toContain("Siggi");
    expect(html).toContain("Gunna");
    // Whoever is in the group already is shown ticked and cannot be changed.
    expect(html).toMatch(/type="checkbox" disabled="" class="size-5" checked=""/u);
    expect(html.match(/type="checkbox"/gu)).toHaveLength(2);
  });

  it("cannot confirm before anyone is picked", () => {
    const confirm = (html: string) =>
      new RegExp(`<button[^>]*?( disabled="")?>${strings.add_people_confirm}<`, "u").exec(html);
    expect(confirm(render())?.[1]).toBe(' disabled=""');
    expect(confirm(render({ picked: new Set(["a-3"]) }))?.[1]).toBeUndefined();
  });

  it("says nobody is there, and nobody was found by that name", () => {
    expect(render({ people: [] })).toContain(strings.people_empty);
    expect(render({ people: [], searching: true })).toContain(strings.people_none_found);
  });

  it("shows the loading word, a failed load and a failed add", () => {
    expect(render({ people: null })).toContain(strings.loading);
    expect(render({ people: null, problem: { kind: "unreachable" } })).not.toContain(
      strings.loading,
    );
    expect(render({ failed: "unreachable" })).toContain(strings.error_unreachable);
    expect(render({ failed: "failed" })).toContain(strings.error_generic);
  });

  it("offers the next page only when there is one", () => {
    expect(render()).not.toContain(strings.history_load_older);
    expect(render({ more: nop })).toContain(strings.history_load_older);
  });
});
