import { DurableObject } from "cloudflare:workers";
import { activeDevices } from "../accounts.ts";
import { WsFrame } from "../api/frames.ts";
import { SOCKET_ACCOUNT, SOCKET_DEVICE } from "../api/socket.ts";
import { conversation } from "../env/index.ts";
import { log } from "../log.ts";
import { pushSender } from "../push.ts";

/** The protocol version `hello` announces (decision 0015). */
const PROTOCOL = 1;

/** How soon a push that failed to send is tried again. */
const RETRY_MS = 30_000;

/** Policy violation: a frame that does not parse, or one only the server sends. */
const POLICY = 1008;

/**
 * The device was revoked, or its account deleted (decision 0019). In the
 * application range, after HTTP's 401: the token is dead, so do not reconnect.
 */
const REVOKED = 4401;

type Attachment = { accountId: string; deviceId: string };

/**
 * One account's devices (decisions 0015, 0017): a hibernating WebSocket per
 * device, the latest `seq` of each conversation, each device's cursor, and a
 * push outbox for devices that are behind with no socket open.
 */
export class Inbox extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.migrate();
  }

  private migrate(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        conversation_id TEXT PRIMARY KEY,
        latest_seq INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cursors (
        device_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        PRIMARY KEY (device_id, conversation_id)
      );
      CREATE TABLE IF NOT EXISTS push_outbox (
        device_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        pushed INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (device_id, conversation_id)
      );
    `);
  }

  /** A WebSocket the Worker has authenticated: `hello`, then what this device has missed. */
  override async fetch(request: Request): Promise<Response> {
    const accountId = request.headers.get(SOCKET_ACCOUNT);
    const deviceId = request.headers.get(SOCKET_DEVICE);
    if (!accountId || !deviceId) return new Response(null, { status: 400 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server!, [deviceId]);
    server!.serializeAttachment({ accountId, deviceId } satisfies Attachment);
    send(server!, { type: "hello", protocol: PROTOCOL, serverTime: new Date().toISOString() });
    for (const { conversation_id, latest_seq } of this.sql
      .exec<{ conversation_id: string; latest_seq: number }>(
        `SELECT c.conversation_id, c.latest_seq FROM conversations c
         LEFT JOIN cursors k ON k.conversation_id = c.conversation_id AND k.device_id = ?
         WHERE c.latest_seq > coalesce(k.seq, 0)`,
        deviceId,
      )
      .toArray()) {
      send(server!, { type: "notify", conversationId: conversation_id, seq: latest_seq });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Completes a close the client started; the runtime does not answer it
   * for us, and the client would wait for the handshake until it timed out.
   */
  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // 1006 means the connection is already gone; 1005 (no code) cannot be sent.
    if (code !== 1006) ws.close(code === 1005 ? 1000 : code, reason);
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const { accountId, deviceId } = ws.deserializeAttachment() as Attachment;
    let frame: WsFrame;
    try {
      frame = WsFrame.parse(JSON.parse(typeof message === "string" ? message : ""));
    } catch {
      ws.close(POLICY, "invalid frame");
      return;
    }
    switch (frame.type) {
      case "ack":
        this.ack(deviceId, frame.conversationId, frame.seq);
        return;
      case "ping":
        send(ws, { type: "pong", ...(frame.nonce !== undefined && { nonce: frame.nonce }) });
        return;
      case "pong":
        return;
      case "typing":
        await conversation(this.env, frame.conversationId).typing(accountId, frame.ciphertext);
        return;
      default:
        ws.close(POLICY, "server frame");
    }
  }

  /** This device has stored up to `seq`: its cursor moves, and its push is no longer owed. */
  private ack(deviceId: string, conversationId: string, seq: number): void {
    this.sql.exec(
      `INSERT INTO cursors (device_id, conversation_id, seq) VALUES (?, ?, ?)
       ON CONFLICT DO UPDATE SET seq = max(seq, excluded.seq)`,
      deviceId,
      conversationId,
      seq,
    );
    this.sql.exec(
      "DELETE FROM push_outbox WHERE device_id = ? AND conversation_id = ? AND seq <= ?",
      deviceId,
      conversationId,
      seq,
    );
  }

  /**
   * Conversation `conversationId` has stored up to `seq`, and its latest
   * urgent message for this account is `urgentSeq`, 0 for none (decisions
   * 0017, 0025). Moves maxima, so a retry repeats nothing. Open sockets get
   * `notify`; a device with no socket that is behind the urgent seq owes a
   * push, and a newer urgent seq owes it again, until it acks.
   */
  async notify(
    accountId: string,
    conversationId: string,
    seq: number,
    urgentSeq: number,
  ): Promise<void> {
    this.sql.exec(
      `INSERT INTO conversations (conversation_id, latest_seq) VALUES (?, ?)
       ON CONFLICT DO UPDATE SET latest_seq = max(latest_seq, excluded.latest_seq)`,
      conversationId,
      seq,
    );
    const online = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const { deviceId } = ws.deserializeAttachment() as Attachment;
      online.add(deviceId);
      if (this.cursor(deviceId, conversationId) < seq) {
        send(ws, { type: "notify", conversationId, seq });
      }
    }
    for (const deviceId of await activeDevices(this.env, accountId)) {
      if (online.has(deviceId) || this.cursor(deviceId, conversationId) >= urgentSeq) continue;
      this.sql.exec(
        `INSERT INTO push_outbox (device_id, conversation_id, seq) VALUES (?, ?, ?)
         ON CONFLICT DO UPDATE SET
           pushed = CASE WHEN excluded.seq > seq THEN 0 ELSE pushed END,
           seq = max(seq, excluded.seq)`,
        deviceId,
        conversationId,
        urgentSeq,
      );
    }
    await this.push();
  }

  /** Relays a typing indicator to this account's open sockets; nothing is stored. */
  async relayTyping(conversationId: string, ciphertext: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets())
      send(ws, { type: "typing", conversationId, ciphertext });
  }

  /** A revoked device: its socket closes, and nothing is owed to it any more (decision 0019). */
  async closeDevice(deviceId: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(deviceId)) ws.close(REVOKED, "revoked");
    this.sql.exec("DELETE FROM cursors WHERE device_id = ?", deviceId);
    this.sql.exec("DELETE FROM push_outbox WHERE device_id = ?", deviceId);
  }

  /**
   * A deleted account (decision 0019): every socket closes and the storage is
   * deleted. The tables are made again, empty, so a late `notify` still lands.
   */
  async wipe(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) ws.close(REVOKED, "deleted");
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.migrate();
  }

  /** The latest seq of each conversation this account has been notified of. */
  async latest(): Promise<Record<string, number>> {
    const rows = this.sql
      .exec<{ conversation_id: string; latest_seq: number }>(
        "SELECT conversation_id, latest_seq FROM conversations",
      )
      .toArray();
    return Object.fromEntries(rows.map((r) => [r.conversation_id, r.latest_seq]));
  }

  override async alarm(): Promise<void> {
    await this.push();
  }

  private cursor(deviceId: string, conversationId: string): number {
    const row = this.sql
      .exec<{ seq: number }>(
        "SELECT seq FROM cursors WHERE device_id = ? AND conversation_id = ?",
        deviceId,
        conversationId,
      )
      .toArray()[0];
    return row?.seq ?? 0;
  }

  /**
   * Sends each device that owes a push one push, however many rows it owes,
   * and marks those rows sent; one that fails is tried again by the alarm. A
   * row re-armed while the push was in flight stays owed.
   */
  private async push(): Promise<void> {
    const sender = pushSender(this.env);
    const due = Map.groupBy(
      this.sql
        .exec<{ device_id: string; conversation_id: string; seq: number }>(
          "SELECT device_id, conversation_id, seq FROM push_outbox WHERE pushed = 0",
        )
        .toArray(),
      (row) => row.device_id,
    );
    let failed = false;
    for (const [deviceId, rows] of due) {
      try {
        await sender.send({ deviceId });
        for (const row of rows) {
          this.sql.exec(
            "UPDATE push_outbox SET pushed = 1 WHERE device_id = ? AND conversation_id = ? AND seq = ?",
            deviceId,
            row.conversation_id,
            row.seq,
          );
        }
      } catch {
        failed = true;
        log("push.failed", { deviceId, count: rows.length });
      }
    }
    if (failed) await this.ctx.storage.setAlarm(Date.now() + RETRY_MS);
  }
}

function send(ws: WebSocket, frame: WsFrame): void {
  ws.send(JSON.stringify(frame));
}
