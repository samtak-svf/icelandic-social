const WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2];
let people = Math.floor(Math.random() * 10_000);

/**
 * A new person's kennitala, born on a day in 2099: structurally valid, so it
 * passes as Kenni's, and nobody's. Computed rather than written out, because
 * tooling/pii-guard.mjs refuses a valid kennitala in any file (as in
 * backend/test/oidc.ts). The start is random, so a rerun against the same
 * `cf dev` state is a new person too.
 */
export function newKennitala(): string {
  for (;;) {
    const n = people++;
    const day = String(1 + (n % 28)).padStart(2, "0");
    const month = String(1 + (Math.floor(n / 28) % 12)).padStart(2, "0");
    const serial = String(20 + (Math.floor(n / 336) % 80)).padStart(2, "0");
    const first = `${day}${month}99${serial}`;
    const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(first[i]), 0);
    const remainder = sum % 11;
    if (remainder === 1) continue;
    return `${first}${remainder === 0 ? 0 : 11 - remainder}0`;
  }
}

/** A new Google subject, nobody's. */
export function newGoogleSubject(): string {
  return `e2e-${crypto.randomUUID()}`;
}
