import type { Report } from "../generated/api.ts";

// Which moderation verbs a report offers (#361).

/**
 * The verbs that apply to the target as it stands. A state or standing the
 * server did not give (null) offers every verb, as before it gave them.
 */
export function verbs(report: Pick<Report, "targetState" | "targetStanding">) {
  const state = report.targetState;
  const standing = report.targetStanding;
  const content = (...states: NonNullable<Report["targetState"]>[]) =>
    state === null || states.includes(state);
  const member = (...standings: NonNullable<Report["targetStanding"]>[]) =>
    standing === null || standings.includes(standing);
  return {
    hide: content("visible"),
    remove: content("visible", "hidden"),
    restore: content("hidden", "removed"),
    mute: member("member"),
    unmute: member("muted"),
    ban: member("member", "muted", "not_member"),
    unban: member("banned"),
  };
}
