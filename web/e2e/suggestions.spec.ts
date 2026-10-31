import { strings } from "../src/generated/brand/strings.ts";
import { expect, test, WEB } from "./origin.ts";
import { found, join, person } from "./social-helpers.ts";

// Suggested people (decision 0114), through what a person sees.

const switchOf = (page: Parameters<typeof found>[0]) =>
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

  // With nobody to suggest, the friends list shows no heading for them.
  await a.goto(`${WEB}/friends`);
  await expect(a.getByRole("heading", { name: strings.person_friends, level: 1 })).toBeVisible();
  await expect(a.getByRole("heading", { name: strings.friends_suggested })).toHaveCount(0);
});

// The server suggests only an account with a name AND a linked device
// (IN_DIRECTORY, backend/src/modules/profiles/profiles.ts), and an e2e account
// signs in on the web with no device, so two of them never meet in the section.
// Needs a linked phone as chat.spec.ts has, or a dev route that seeds a device.
test.fixme("two accounts in an open community see each other, until one opts out", async ({
  browser,
}) => {
  const a = await person(browser, "Aaa Tillagadóttir");
  const b = await person(browser, "Aaa Tillagason");
  await join(b, await found(a, "open"));

  await a.goto(`${WEB}/friends`);
  await expect(a.getByRole("heading", { name: strings.friends_suggested })).toBeVisible();
  await expect(a.getByRole("link", { name: /Aaa Tillagason/ })).toBeVisible();

  await b.goto(`${WEB}/settings`);
  await switchOf(b).click();
  await expect(switchOf(b)).not.toBeChecked();

  await a.goto(`${WEB}/friends`);
  await expect(a.getByRole("link", { name: /Aaa Tillagason/ })).toHaveCount(0);
  await b.goto(`${WEB}/friends`);
  await expect(b.getByRole("heading", { name: strings.friends_suggested })).toHaveCount(0);
});
