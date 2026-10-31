import type { Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import { expect, WEB } from "./origin.ts";
import { newGoogleSubject, newKennitala } from "./people.ts";

// Signing in through what a person sees (decision 0069): Google is the only
// way in, and Kenni adds the mark afterwards from the verify page.

/** At a provider's fake: who signs in, and as what name. */
async function atProvider(page: Page, person: string, name: string) {
  await page.locator('input[name="login_hint"]').fill(person);
  await page.locator('input[name="x_name"]').fill(name);
  await page.getByRole("button").click();
}

/** Signs in with Google from the sign-in page as `name`; the feed opens, Ég shows the name. */
export async function signIn(page: Page, name: string, subject = newGoogleSubject()) {
  await page.goto(`${WEB}/`);
  await page.getByRole("heading", { name: strings.sign_in_title }).waitFor();
  await page.getByRole("link", { name: strings.sign_in_google }).click();
  await atProvider(page, subject, name);
  await page.waitForURL(`${WEB}/`);
  await page.getByRole("link", { name: strings.tab_me }).click();
  await page.waitForURL(`${WEB}/me`);
  await expect(page.getByText(name)).toBeVisible();
}

/** From Ég, adds the mark with Kenni as `name`; the verify page says what happened. */
export async function addMark(page: Page, name: string, kennitala = newKennitala()) {
  await page.getByRole("link", { name: strings.tab_me }).click();
  await page.getByRole("link", { name: strings.verify_cta }).click();
  await page.getByRole("link", { name: strings.verify_action }).click();
  await atProvider(page, kennitala, name);
  await page.waitForURL(/\/verify\?verify=/);
}

/**
 * A verified person: signed in with Google, marked by Kenni, on Ég. A
 * kennitala an earlier run against the same `cf dev` state already linked
 * is refused as taken; that person exists, so another one is drawn.
 */
export async function signInVerified(page: Page, name: string) {
  await signIn(page, name);
  const linked = page.getByRole("status").filter({ hasText: strings.verify_linked });
  const taken = page.getByText(strings.identity_taken);
  for (let attempt = 0; ; attempt++) {
    await addMark(page, name);
    await expect(linked.or(taken)).toBeVisible();
    if (await linked.isVisible()) break;
    expect(attempt, "every kennitala drawn was taken").toBeLessThan(4);
  }
  await page.getByRole("link", { name: strings.tab_me }).first().click();
  await expect(page.getByText(strings.verified_short)).toBeVisible();
}
