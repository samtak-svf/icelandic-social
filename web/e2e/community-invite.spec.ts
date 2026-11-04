import type { Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import { accountOf, expectMember, found, manage, person, runJobs } from "./social-helpers.ts";
import { CLIENT, expect, test, WEB } from "./origin.ts";

// Decision 0130: a moderator's invitation reaches the invited person as a
// notice and as an answer on the community's page, and the moderator sees the
// invitations that wait and can take one back (#558).

const MODERATOR = "Umsjón Boðsdóttir";

/**
 * The moderator invites `invited` as the page does: the dialog lists only accounts with a device
 * (listPeople), and a web-only account has none, so the call is the one the dialog makes.
 */
async function invite(moderator: Page, community: string, invited: Page) {
  const communityId = community.split("/").pop() ?? "";
  const accountId = await accountOf(invited);
  const status = await moderator.evaluate(
    async ([id, account, headers]) =>
      (
        await fetch(`/v1/communities/${id}/invitations/${account}`, {
          method: "PUT",
          headers,
        })
      ).status,
    [communityId, accountId, CLIENT] as const,
  );
  expect(status).toBe(204);
}

/** The notice of the invitation in the invited person's list of notices. */
async function notice(page: Page) {
  await page.goto(WEB);
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

  await invite(moderator, community, a);
  await invite(moderator, community, b);
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
  await invite(moderator, community, c);
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
