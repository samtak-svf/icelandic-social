import { strings } from "../src/generated/brand/strings.ts";
import { accountOf, layoutWidth, pageOverflow, person, runJobs } from "./social-helpers.ts";
import { expect, test, WEB } from "./origin.ts";

// A person's screen and the friend list (decision 0114), through what a person
// sees: a request, its notice, the answer, and that a page rendered for someone
// signed out says nothing about the person it is for.

const button = (name: string) => ({ name, exact: true });

test("a request is sent, noticed and accepted, and the two then read as friends", async ({
  browser,
}) => {
  test.slow();
  const a = await person(browser, "Auður Prófsdóttir");
  const b = await person(browser, "Björn Prófsson");
  const aId = await accountOf(a);
  const bId = await accountOf(b);

  await a.goto(`${WEB}/people/${bId}`);
  await expect(a.getByRole("heading", { level: 1 })).toContainText("Björn Prófsson");
  await a.getByRole("button", button(strings.person_add_friend)).click();
  await expect(a.getByText(strings.person_request_sent, { exact: true })).toBeVisible();
  await a.reload();
  await expect(a.getByRole("button", button(strings.person_cancel_request))).toBeVisible();

  await runJobs();
  await b.goto(`${WEB}/notifications`);
  const notice = strings.notice_friend_request({ name: "Auður Prófsdóttir" });
  await b.getByText(notice, { exact: true }).click();
  await expect(b).toHaveURL(new RegExp(`/people/${aId}$`));
  await b.getByRole("button", button(strings.person_accept)).click();
  await expect(b.getByText(strings.person_friends, { exact: true })).toBeVisible();

  await runJobs();
  await a.goto(`${WEB}/notifications`);
  await expect(
    a.getByText(strings.notice_friend_accepted({ name: "Björn Prófsson" }), { exact: true }),
  ).toBeVisible();

  await a.goto(`${WEB}/friends`);
  await expect(a.getByRole("link", { name: /Björn Prófsson/ })).toBeVisible();
  await a.getByRole("searchbox").fill("ekkert slíkt");
  await expect(a.getByText(strings.friends_search_empty, { exact: true })).toBeVisible();
});

test("declined, it reads as still sent to the one who asked", async ({ browser }) => {
  const a = await person(browser, "Auður Prófsdóttir");
  const b = await person(browser, "Björn Prófsson");
  const bId = await accountOf(b);
  await a.goto(`${WEB}/people/${bId}`);
  await a.getByRole("button", button(strings.person_add_friend)).click();
  await expect(a.getByText(strings.person_request_sent, { exact: true })).toBeVisible();

  await b.goto(`${WEB}/friends`);
  await b.getByRole("button", button(strings.person_decline)).click();
  await expect(b.getByRole("button", button(strings.person_decline))).toHaveCount(0);

  await a.reload();
  await expect(a.getByText(strings.person_request_sent, { exact: true })).toBeVisible();
});

test("a block closes the screen to both sides", async ({ browser }) => {
  const a = await person(browser, "Auður Prófsdóttir");
  const b = await person(browser, "Björn Prófsson");
  const aId = await accountOf(a);
  const bId = await accountOf(b);
  await a.goto(`${WEB}/people/${bId}`);
  a.on("dialog", (dialog) => void dialog.accept());
  await a.getByRole("button", { name: strings.notice_menu }).click();
  await a.getByRole("menuitem", { name: strings.block, exact: true }).click();
  await expect(a).toHaveURL(/\/friends$/);

  await a.goto(`${WEB}/people/${bId}`);
  await expect(a.getByText(strings.problem_not_found, { exact: true })).toBeVisible();
  await b.goto(`${WEB}/people/${aId}`);
  await expect(b.getByText(strings.problem_not_found, { exact: true })).toBeVisible();
});

test("fits a phone, with no sideways scroll", async ({ browser }) => {
  const a = await person(browser, "Auður Prófsdóttir");
  const b = await person(browser, "Björn Prófsson");
  await a.setViewportSize({ width: 390, height: 844 });
  for (const path of [`/people/${await accountOf(b)}`, "/friends"]) {
    await a.goto(`${WEB}${path}`);
    await expect(a.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await pageOverflow(a)).toBeLessThanOrEqual(0);
    expect(await layoutWidth(a)).toBeLessThanOrEqual(390);
  }
});

test("signed out, the page names nobody", async ({ browser }) => {
  const b = await person(browser, "Björn Sérstakur Prófsson");
  const bId = await accountOf(b);
  const answer = await fetch(`${WEB}/people/${bId}`);
  const html = await answer.text();
  expect(html).toContain(`<title>${strings.app_name}</title>`);
  expect(html).not.toContain("Sérstakur");
  expect(html).not.toContain("friendCount");
  expect(html).not.toContain("og:title");
});
