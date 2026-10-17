import { minClientVersions } from "./env/index.ts";

// The client version floor (decision 0030): every request names its build in
// Spjall-Client, and a build below its platform's minimum is told to update.

/** `<platform>/<major.minor.patch>`, set by the core on every request. */
export const CLIENT_HEADER = "spjall-client";

const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

/** The version of every build made before the header existed. */
const UNNAMED = "0.1.0";

/** Orders two `major.minor.patch` versions. */
function compare(a: string, b: string): number {
  const [x, y] = [a.split(".").map(Number), b.split(".").map(Number)];
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export type FloorRefusal =
  | { error: "invalid_request" }
  | { error: "client_too_old"; minVersion: string };

/** Why a request with this Spjall-Client may not go on, or null. */
export function belowFloor(env: Env, header: string | undefined): FloorRefusal | null {
  return belowFloorOf(minClientVersions(env), header);
}

/**
 * The same against any clients' floors: a header names one of them, and a
 * request without one is `UNNAMED` on whichever app floor is highest. Only
 * an app built before the header leaves it out; the web always sends it.
 */
export function belowFloorOf(
  floors: Readonly<Record<string, string>>,
  header: string | undefined,
): FloorRefusal | null {
  let version = UNNAMED;
  let floor = Object.entries(floors)
    .flatMap(([client, min]) => (client === "web" ? [] : [min]))
    .reduce((a, b) => (compare(a, b) >= 0 ? a : b));
  if (header !== undefined) {
    const slash = header.indexOf("/");
    const platform = header.slice(0, slash);
    version = header.slice(slash + 1);
    if (slash < 0 || !Object.hasOwn(floors, platform) || !VERSION.test(version))
      return { error: "invalid_request" };
    floor = floors[platform]!;
  }
  return compare(version, floor) < 0 ? { error: "client_too_old", minVersion: floor } : null;
}
