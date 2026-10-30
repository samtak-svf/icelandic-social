import { strings } from "../generated/brand/strings.ts";

/** A day, in milliseconds. */
export const DAY = 24 * 60 * 60 * 1000;

/** The lengths a moderator picks from, in days, for a mute and for a suspension. */
export const MUTES = [
  [1, strings.moderation_mute_day],
  [7, strings.moderation_mute_week],
  [30, strings.moderation_mute_month],
] as const;
