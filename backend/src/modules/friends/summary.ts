import { parseFraming } from "../../api/image-frames.ts";

// One person in a friends list: the columns of an account row `a`, and the shape a client gets.

/** The columns `summaryOf` reads, from `accounts a`. */
export const SUMMARY = `a.account_id AS accountId, a.display_name AS name, a.verified,
  a.photo_version AS photo, a.photo_frames AS frames`;

export type SummaryRow = {
  accountId: string;
  name: string | null;
  verified: number;
  photo: string | null;
  frames: string | null;
};

export function summaryOf(row: SummaryRow) {
  return {
    accountId: row.accountId,
    name: row.name,
    verified: row.verified === 1,
    photo: row.photo,
    photoFrames: parseFraming(row.frames),
  };
}
