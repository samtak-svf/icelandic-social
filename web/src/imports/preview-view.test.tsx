import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ImportDetail } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { mayOpen } from "./held.tsx";
import { PreviewView } from "./preview.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
  useNavigate: () => () => undefined,
}));

// Opening the last held posts empties the held section on reload; the message about it must stay.
const emptied: ImportDetail = {
  state: "done",
  failure: null,
  counts: { posts: 1, images: 0, videos: 0, skipped: 0, earliest: 0, latest: 0 },
  classes: [],
  lost: { videoOnly: 0, foreignOnly: 0, foreignImages: 0, empty: 0, videoFiles: 0, videoBytes: 0 },
  held: { posts: 0, groups: [] },
};

const draw = (opened: number | null) =>
  renderToStaticMarkup(
    <PreviewView
      status={{ ok: true, data: emptied }}
      opened={opened}
      removing={false}
      problem={null}
      remove={() => undefined}
      chooser={null}
      held={mayOpen(emptied) ? <p>held section</p> : null}
    />,
  );

describe("the preview after the held section empties", () => {
  it("still says how many were opened", () => {
    expect(draw(1)).toContain(strings.imports_held_opened({ count: 1 }));
    expect(draw(1)).not.toContain("held section");
  });

  it("says nothing before anything was opened", () => {
    expect(draw(null)).not.toContain(strings.imports_held_opened({ count: 1 }));
  });
});
