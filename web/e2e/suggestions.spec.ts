import type { Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import { CLIENT, expect, test, WEB } from "./origin.ts";
import { found, join, pageOverflow, person, withPhone } from "./social-helpers.ts";

// Suggested people (decision 0114), through what a person sees.

const switchOf = (page: Page) =>
  page.getByRole("switch", { name: new RegExp(strings.suggestions_setting_label) });

test("the settings switch is on until it is turned off, and stays as it was left", async ({
  browser,
}) => {
  const a = await person(browser, "Tillaga Rofadóttir");
  await a.goto(`${WEB}/settings`);
  await expect(switchOf(a)).toBeChecked();
  await switchOf(a).click();
  await expect(switchOf(a)).not.toBeChecked();
  await a.reload();
  await expect(switchOf(a)).not.toBeChecked();
  await switchOf(a).click();
  await expect(switchOf(a)).toBeChecked();
});

// The server suggests only an account with a name and a device (IN_DIRECTORY,
// backend/src/modules/profiles/profiles.ts); a person who signs in on the web
// alone has none, so each of these is given a phone. The section loads after
// the page, so a person who must be gone is only looked for once a third, who
// stays, is on the screen: alone, an absence holds before anything has loaded.

/** The section itself: the same person is also a link among the requests sent. */
const suggested = (page: Page) =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: strings.friends_suggested }) });

/** Who the server suggests to the person in `page`, by name. */
const suggestedTo = (page: Page) =>
  page.evaluate(async (headers) => {
    const answer = await fetch("/v1/friend-suggestions", { headers });
    const body = (await answer.json()) as { people: { name: string }[] };
    return body.people.map((shown) => shown.name);
  }, CLIENT);

test("two accounts in an open community see each other, until one opts out", async ({
  browser,
}) => {
  const a = await person(browser, "Aaa Tillagadóttir");
  const b = await person(browser, "Aaa Tillagason");
  const stays = await person(browser, "Aab Tillagason");
  for (const page of [a, b, stays]) await withPhone(page);
  const address = await found(a, "open");
  await join(b, address);
  await join(stays, address);

  await a.goto(`${WEB}/friends`);
  await expect(suggested(a).getByRole("link", { name: /Aaa Tillagason/ })).toBeVisible();

  await a.setViewportSize({ width: 320, height: 640 });
  expect(await pageOverflow(a)).toBeLessThanOrEqual(0);

  expect(await suggestedTo(b)).toContain("Aaa Tillagadóttir");
  await b.goto(`${WEB}/settings`);
  await switchOf(b).click();
  await expect(switchOf(b)).not.toBeChecked();

  await a.goto(`${WEB}/friends`);
  await expect(suggested(a).getByRole("link", { name: /Aab Tillagason/ })).toBeVisible();
  await expect(suggested(a).getByRole("link", { name: /Aaa Tillagason/ })).toHaveCount(0);
  expect(await suggestedTo(b)).toEqual([]);
});

test("a person asked leaves the suggestions and is asked for real", async ({ browser }) => {
  const a = await person(browser, "Aaa Beiðnadóttir");
  const b = await person(browser, "Aaa Beiðnason");
  const stays = await person(browser, "Aab Beiðnason");
  for (const page of [b, stays]) await withPhone(page);
  const address = await found(b, "open");
  await join(a, address);
  await join(stays, address);

  await a.goto(`${WEB}/friends`);
  const asked = suggested(a).getByRole("listitem").filter({ hasText: "Aaa Beiðnason" });
  await asked.getByRole("button", { name: strings.person_add_friend }).click();
  await expect(asked).toHaveCount(0);

  await b.goto(`${WEB}/friends`);
  await expect(b.getByText("Aaa Beiðnadóttir").first()).toBeVisible();
  await a.reload();
  await expect(suggested(a).getByRole("link", { name: /Aab Beiðnason/ })).toBeVisible();
  await expect(suggested(a).getByRole("link", { name: /Aaa Beiðnason/ })).toHaveCount(0);
});
