import { exports } from "cloudflare:workers";
import { expect } from "vitest";

// A client for the socket of decision 0015, shared by the socket and the
// end-to-end tests.

type Frame = Record<string, unknown>;

export async function connect(auth: Record<string, string>, extra: Record<string, string> = {}) {
  const response = await exports.default.fetch("https://spjall.test/v1/ws", {
    headers: { upgrade: "websocket", ...auth, ...extra },
  });
  expect(response.status).toBe(101);
  const ws = response.webSocket!;
  const queued: Frame[] = [];
  const waiting: ((frame: Frame) => void)[] = [];
  ws.addEventListener("message", (event) => {
    const frame = JSON.parse(event.data as string) as Frame;
    const waiter = waiting.shift();
    if (waiter) waiter(frame);
    else queued.push(frame);
  });
  const closed = new Promise<CloseEvent>((resolve) => ws.addEventListener("close", resolve));
  ws.accept();
  return {
    ws,
    closed,
    send: (frame: Frame) => ws.send(JSON.stringify(frame)),
    next: () =>
      queued.length
        ? Promise.resolve(queued.shift()!)
        : new Promise<Frame>((resolve) => waiting.push(resolve)),
    /** The next frame of a type, skipping the `notify` frames a send causes. */
    async nextOf(type: string): Promise<Frame> {
      for (;;) {
        const frame = await this.next();
        if (frame.type === type || frame.type !== "notify") return frame;
      }
    },
    /** Everything sent before this answers before the pong: a way to show nothing else came. */
    async settle(nonce: string) {
      ws.send(JSON.stringify({ type: "ping", nonce }));
      return this.nextOf("pong");
    },
  };
}
