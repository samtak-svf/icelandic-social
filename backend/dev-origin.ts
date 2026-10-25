// Where `cf dev` listens: one place for the dev server (vite.config.ts), the
// fake providers' issuer URLs (cloudflare.config.ts) and the operator invite
// script. Config code, so nothing under src/ may import it.
//
// 8787 is the port the apps and a debug Android build expect (AGENTS.md
// § Commands). CI sets SPJALL_DEV_PORT to a free port per job
// (scripts/dev-worker.sh), so two Workers run on one machine at once.

/** The port `cf dev` binds: SPJALL_DEV_PORT, else 8787. */
export function devPort(env: Record<string, string | undefined> = process.env): number {
  const raw = env.SPJALL_DEV_PORT;
  if (raw === undefined || raw === "") return 8787;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SPJALL_DEV_PORT must be a port number, got "${raw}"`);
  }
  return port;
}

/** The origin `cf dev` serves on, on IPv4 like the fake Kenni's issuer. */
export function devOrigin(env: Record<string, string | undefined> = process.env): string {
  return `http://127.0.0.1:${devPort(env)}`;
}
