import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { endSession, getMe, listPeople, setPhoto } from "../generated/api.ts";

/** A fetch that records each request and answers with `answer`. */
function fake(answer: () => Response) {
  const seen: Request[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input;
    seen.push(new Request(new URL(url, "https://web.test"), init));
    return answer();
  };
  return { seen, init: { fetch } };
}

const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("call", () => {
  it("names the build, sends the cookie on the same origin, and encodes the path", async () => {
    const { seen, init } = fake(() => new Response(null, { status: 204 }));
    expect(await endSession({ path: { sessionId: "a/b c" } }, init)).toEqual({
      status: 204,
      data: undefined,
    });
    const [request] = seen;
    expect(request?.method).toBe("DELETE");
    expect(new URL(request?.url ?? "").pathname).toBe("/v1/sessions/a%2Fb%20c");
    expect(request?.headers.get("spjall-client")).toBe(`web/${pkg.version}`);
    expect(request?.credentials).toBe("same-origin");
  });

  it("fills the query and leaves out what is not given", async () => {
    const { seen, init } = fake(json({ people: [] }));
    expect(await listPeople({ query: { q: "jón", limit: 5 } }, init)).toEqual({
      status: 200,
      data: { people: [] },
    });
    expect(new URL(seen[0]?.url ?? "").search).toBe("?q=j%C3%B3n&limit=5");
  });

  it("hands back a refusal with its body, not as a throw", async () => {
    const { init } = fake(json({ error: "unauthorized", requestId: "r" }, 401));
    expect(await getMe(init)).toEqual({
      status: 401,
      data: { error: "unauthorized", requestId: "r" },
    });
  });

  it("sends bytes as they are, and refuses a body that is not bytes", async () => {
    const { seen, init } = fake(json({ photo: "v1" }));
    await setPhoto({ body: new Uint8Array([1, 2, 3]).buffer }, init);
    const request = seen[0] ?? new Request("x:");
    expect(request.headers.get("content-type")).toBe("application/octet-stream");
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    // @ts-expect-error: the contract says bytes.
    await expect(setPhoto({ body: "text" }, init)).rejects.toThrow(TypeError);
  });

  it("reads a body that is not JSON as a blob", async () => {
    const { init } = fake(() => new Response("x", { headers: { "content-type": "image/webp" } }));
    const answer = await getMe(init);
    expect((answer.data as unknown) instanceof Blob).toBe(true);
  });
});
