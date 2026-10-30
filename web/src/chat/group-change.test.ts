import { afterEach, describe, expect, it } from "vitest";
import { changeGroup, type GroupChange, groupProblem, nameOf } from "./group-change";
import { chatClient, type Handlers, type Port, serve } from "./protocol";

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const c of channels.splice(0)) {
    c.port1.close();
    c.port2.close();
  }
});

function ends(): [Port, Port] {
  const channel = new MessageChannel();
  channels.push(channel);
  channel.port1.start();
  channel.port2.start();
  return [channel.port1, channel.port2];
}

const unused = async () => {
  throw new Error("not called");
};

/** A worker whose four group calls log what they were asked, and fail with `fail` when set. */
function worker(fail?: { code: string; message: string }) {
  const log: unknown[][] = [];
  const run = (...entry: unknown[]) => {
    log.push(entry);
    if (fail !== undefined) throw fail;
  };
  const [page, side] = ends();
  const handlers: Handlers = {
    start: unused,
    beginLink: unused,
    pendingLink: unused,
    linkState: unused,
    completeLink: unused,
    receiveHistory: unused,
    sync: unused,
    frame: unused,
    conversations: unused,
    timeline: unused,
    send: unused,
    groupPhoto: unused,
    setGroupPhoto: unused,
    clearGroupPhoto: unused,
    addAccounts: (c, accounts) => run("addAccounts", c, accounts),
    removeAccounts: (c, accounts) => run("removeAccounts", c, accounts),
    rename: (c, name) => {
      run("rename", c, name);
      return "env-1";
    },
    leave: (c) => run("leave", c),
    me: unused,
    wipe: unused,
  };
  serve(side, handlers);
  return { call: chatClient(page), log };
}

describe("a change of a group (0078)", () => {
  it("adds the picked accounts", async () => {
    const { call, log } = worker();
    expect(await changeGroup(call, "c-1", { kind: "add", accounts: ["a-2", "a-3"] })).toBeNull();
    expect(log).toEqual([["addAccounts", "c-1", ["a-2", "a-3"]]]);
  });

  it("removes one member", async () => {
    const { call, log } = worker();
    expect(await changeGroup(call, "c-1", { kind: "remove", account: "a-2" })).toBeNull();
    expect(log).toEqual([["removeAccounts", "c-1", ["a-2"]]]);
  });

  it("names the group, or clears the name", async () => {
    const { call, log } = worker();
    expect(await changeGroup(call, "c-1", { kind: "rename", name: "Bókaklúbbur" })).toBeNull();
    expect(await changeGroup(call, "c-1", { kind: "rename", name: null })).toBeNull();
    expect(log).toEqual([
      ["rename", "c-1", "Bókaklúbbur"],
      ["rename", "c-1", null],
    ]);
  });

  it("leaves the group", async () => {
    const { call, log } = worker();
    expect(await changeGroup(call, "c-1", { kind: "leave" })).toBeNull();
    expect(log).toEqual([["leave", "c-1"]]);
  });

  it("says unreachable when the network is down, for each of the four", async () => {
    const { call } = worker({ code: "unreachable", message: "offline" });
    const changes: GroupChange[] = [
      { kind: "add", accounts: ["a-2"] },
      { kind: "remove", account: "a-2" },
      { kind: "rename", name: "x" },
      { kind: "leave" },
    ];
    for (const change of changes) {
      expect(await changeGroup(call, "c-1", change)).toBe("unreachable");
    }
  });

  it("says failed for anything else, a refused name included", async () => {
    const { call } = worker({ code: "name-invalid", message: "too long" });
    expect(await changeGroup(call, "c-1", { kind: "rename", name: "x" })).toBe("failed");
  });
});

describe("what a change's failure becomes", () => {
  it("tells the network from everything else", () => {
    expect(groupProblem({ code: "unreachable", message: "x" })).toBe("unreachable");
    expect(groupProblem({ code: "not-a-group", message: "x" })).toBe("failed");
    expect(groupProblem(new Error("boom"))).toBe("failed");
  });
});

describe("the name as the core takes it", () => {
  it("trims, and treats a blank one as none", () => {
    expect(nameOf("  Bókaklúbbur ")).toBe("Bókaklúbbur");
    expect(nameOf("   ")).toBeNull();
    expect(nameOf("")).toBeNull();
  });
});
