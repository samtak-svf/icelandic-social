import type { Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import { expectMember, found, manage, person, runJobs } from "./social-helpers.ts";
import { expect, test } from "./origin.ts";

// Decision 0130: a moderator's invitation reaches the invited person as a
// notice and as an answer on the community's page, and the moderator sees the
// invitations that wait and can take one back (#558).

const MODERATOR = "Umsjón Boðsdóttir";

/** The moderator invites `name` from the community's page, through the invitation dialog. */
async function invite(moderator: Page, community: string, name: string) {
  await moderator.goto(community);
  await moderator.getByRole("button", { name: strings.invite, exact: true }).click();
  const dialog = moderator.getByRole("dialog");
  await dialog.getByRole("searchbox").fill(name);
  const row = dialog.getByRole("listitem").filter({ hasText: name });
  await row.getByRole("button", { name: strings.invite, exact: true }).click();
  await expect(dialog.getByText(strings.community_invite_sent)).toBeVisible();
  await moderator.keyboard.press("Escape");
}

/** The notice of the invitation in the invited person's list of notices. */
async function notice(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: new RegExp(strings.notifications_title) }).click();
  await expect(page.getByRole("heading", { name: strings.notifications_title })).toBeVisible();
  return page.getByText(strings.notice_community_invite({ name: MODERATOR }), { exact: true });
}

test("an invitation is noticed, declined, accepted and withdrawn", async ({ browser }) => {
  test.slow();
  const moderator = await person(browser, MODERATOR);
  const a = await person(browser, "Anna Boðnadóttir");
  const b = await person(browser, "Bjarni Boðnason");
  const c = await person(browser, "Cecilía Boðnadóttir");
  const community = await found(moderator, "private", "Lokaður hópur.");

  await invite(moderator, community, "Anna Boðnadóttir");
  await invite(moderator, community, "Bjarni Boðnason");
  await runJobs();

  // A sees the notice and, on the community's page, who asked; no join request is offered.
  await expect(await notice(a)).toHaveCount(1);
  await a.goto(community);
  await expect(a.getByText(strings.community_invited_by({ name: MODERATOR }))).toBeVisible();
  await expect(a.getByRole("button", { name: strings.community_request_join })).toHaveCount(0);
  await a.getByRole("button", { name: strings.community_decline_invite }).click();
  await expect(a.getByRole("button", { name: strings.community_request_join })).toBeVisible();
  await expect(await notice(a)).toHaveCount(0);

  // B accepts, is a member at once, and the notice goes.
  await expect(await notice(b)).toHaveCount(1);
  await b.goto(community);
  await b.getByRole("button", { name: strings.community_accept_invite }).click();
  await expectMember(b);
  await expect(await notice(b)).toHaveCount(0);

  // C is invited, the moderator sees C waiting and takes the invitation back.
  await invite(moderator, community, "Cecilía Boðnadóttir");
  await runJobs();
  await expect(await notice(c)).toHaveCount(1);
  await moderator.goto(community);
  await manage(moderator);
  await moderator.getByRole("link", { name: strings.join_requests_title }).click();
  await expect(
    moderator.getByRole("heading", { name: strings.community_invitations_pending }),
  ).toBeVisible();
  const waiting = moderator.getByRole("article").filter({ hasText: "Cecilía" });
  await expect(
    waiting.getByText(strings.community_invitation_from({ name: MODERATOR })),
  ).toBeVisible();
  await waiting.getByRole("button", { name: strings.community_withdraw_invite }).click();
  await expect(waiting).toHaveCount(0);
  await expect(
    moderator.getByRole("heading", { name: strings.community_invitations_pending }),
  ).toHaveCount(0);
  await expect(await notice(c)).toHaveCount(0);
});
