import { describe, expect, it } from "vitest";
import { signInHref } from "./sign-in-href.ts";

describe("signInHref", () => {
  it("starts plainly from the home page", () => {
    expect(signInHref("/")).toBe("/auth/google/start");
    expect(signInHref("")).toBe("/auth/google/start");
  });

  it("comes back to the page it started from, query included", () => {
    expect(signInHref("/communities/cm_1?tab=posts")).toBe(
      "/auth/google/start?next=%2Fcommunities%2Fcm_1%3Ftab%3Dposts",
    );
  });

  it("leaves the hash behind", () => {
    expect(signInHref("/posts/p_1#c_2")).toBe("/auth/google/start?next=%2Fposts%2Fp_1");
  });
});
