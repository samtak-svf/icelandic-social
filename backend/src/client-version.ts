import { minClientVersions } from "./env/index.ts";

// The client version floor (decision 0030): every request names its build in
// Spjall-Client, and a build below its platform's minimum is told to update.

/** `<platform>/<major.minor.patch>`, set by the core on every request. */
export const CLIENT_HEADER = "spjall-client";

const HEADER = /^(android|ios)\/(\d{1,6}\.\d{1,6}\.\d{1,6})$/;

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

/**
 * Why a request with this Spjall-Client may not go on, or null. A request
 * without one is `UNNAMED` on whichever platform's floor is higher.
 */
export function belowFloor(env: Env, header: string | undefined): FloorRefusal | null {
  const floors = minClientVersions(env);
  let version = UNNAMED;
  let floor = compare(floors.android, floors.ios) >= 0 ? floors.android : floors.ios;
  if (header !== undefined) {
    const named = HEADER.exec(header);
    if (!named) return { error: "invalid_request" };
    const platform = named[1] as keyof typeof floors;
    version = named[2]!;
    floor = floors[platform];
  }
  return compare(version, floor) < 0 ? { error: "client_too_old", minVersion: floor } : null;
}
