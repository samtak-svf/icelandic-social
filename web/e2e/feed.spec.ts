import type { Page } from "@playwright/test";
import { strings } from "../src/generated/brand/strings.ts";
import {
  accountOf,
  befriend,
  found,
  join,
  layoutWidth,
  pageOverflow,
  person,
  post,
  titleOf,
  write,
} from "./social-helpers.ts";
import { CLIENT, expect, test, WEB } from "./origin.ts";

// Fljótið (decision 0116) through what a person sees: communities, friends and
// one's own wall in one list, what it leaves out, the composer's two kinds of
// place, and the cursor that follows pages (an empty one may still have more).

/** A request as the signed-in person in `page`, from the page itself; the answer's status. */
async function send(page: Page, method: string, path: string, body?: unknown): Promise<number> {
  return page.evaluate(
    async (call) =>
      (
        await fetch(call.path, {
          method: call.method,
          headers: { ...call.headers, "content-type": "application/json" },
          body: call.body === undefined ? undefined : JSON.stringify(call.body),
        })
      ).status,
    { method, path, body, headers: CLIENT },
  );
}

/** The community's id, read off its address. */
const idOf = (address: string) => address.split("/").at(-1) ?? "";

/** Opens the feed, which the app opens on. */
async function openFeed(page: Page) {
  await page.goto(`${WEB}/`);
  await expect(page.getByRole("heading", { level: 1, name: strings.tab_feed })).toBeAttached();
}

test("the feed gathers communities, friends and one's own wall, and leaves out a snoozed friend and a blocked person", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const a = await person(browser, "Auður Prófsdóttir");
  const friend = await person(browser, "Vinur Prófsson");
  const snoozed = await person(browser, "Hvíld Prófsdóttir");
  const blocked = await person(browser, "Lokaður Prófsson");

  const community = await found(friend, "open");
  await join(a, community);
  await join(blocked, community);
  await write(friend, strings.post_compose, strings.post_publish, "Póstur úr félaginu");
  await write(blocked, strings.post_compose, strings.post_publish, "Póstur frá lokuðum");

  await befriend(a, friend);
  await befriend(a, snoozed);
  expect(
    await send(friend, "POST", "/v1/wall/posts", { body: "Póstur frá vini" }),
    "a wall post for friends",
  ).toBe(200);
  expect(await send(snoozed, "POST", "/v1/wall/posts", { body: "Póstur frá földum vini" })).toBe(
    200,
  );

  // The three sources, every one in view.
  await openFeed(a);
  // Loaded, so the page is hydrated and the prompt answers a click.
  await expect(post(a, "Póstur úr félaginu")).toBeVisible();
  await write(a, strings.post_compose, strings.post_publish, "Póstur á mínum vegg");
  for (const text of [
    "Póstur úr félaginu",
    "Póstur frá vini",
    "Póstur á mínum vegg",
    "Póstur frá földum vini",
    "Póstur frá lokuðum",
  ]) {
    await expect(post(a, text)).toBeVisible();
  }

  // Snoozing a friend and blocking a person take their posts out of the list.
  await a.goto(`${WEB}/people/${await accountOf(snoozed)}`);
  await a.getByRole("button", { name: strings.notice_menu }).click();
  await a.getByRole("menuitem", { name: strings.person_snooze, exact: true }).click();
  await a.getByRole("button", { name: strings.notice_menu }).click();
  await expect(
    a.getByRole("menuitem", { name: strings.person_unsnooze, exact: true }),
  ).toBeVisible();
  await a.keyboard.press("Escape");
  a.on("dialog", (dialog) => void dialog.accept());
  await a.goto(`${WEB}/people/${await accountOf(blocked)}`);
  await a.getByRole("button", { name: strings.notice_menu }).click();
  await a.getByRole("menuitem", { name: strings.block, exact: true }).click();
  await expect(a).toHaveURL(/\/friends$/);

  await openFeed(a);
  await expect(post(a, "Póstur úr félaginu")).toBeVisible();
  await expect(post(a, "Póstur frá vini")).toBeVisible();
  await expect(post(a, "Póstur á mínum vegg")).toBeVisible();
  await expect(post(a, "Póstur frá földum vini")).toHaveCount(0);
  await expect(post(a, "Póstur frá lokuðum")).toHaveCount(0);
});

test("a post for friends is absent from the feed of someone who is not a friend", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const author = await person(browser, "Höfundur Prófsson");
  const friend = await person(browser, "Vinkona Prófsdóttir");
  const stranger = await person(browser, "Ókunnug Prófsdóttir");
  const community = await found(author, "open");
  await join(friend, community);
  await join(stranger, community);
  await befriend(friend, author);
  await author.goto(community);
  await expect(author.getByRole("button", { name: strings.post_compose_prompt })).toBeVisible();
  await write(author, strings.post_compose, strings.post_publish, "Póstur úr samfélagi höfundar");
  expect(await send(author, "POST", "/v1/wall/posts", { body: "Aðeins fyrir vini" })).toBe(200);

  await openFeed(friend);
  await expect(post(friend, "Aðeins fyrir vini")).toBeVisible();

  // The stranger's feed shows the community's post, so it has loaded: the wall post is what is missing.
  await openFeed(stranger);
  await expect(post(stranger, "Póstur úr samfélagi höfundar")).toBeVisible();
  await expect(post(stranger, "Aðeins fyrir vini")).toHaveCount(0);
});

test("the composer writes on the wall unless a community is picked, and only the wall has an audience", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const a = await person(browser, "Auður Prófsdóttir");
  const community = await found(a, "open");
  const name = await titleOf(a);
  await openFeed(a);
  // Loaded, so the page is hydrated and the prompt answers a click.
  await expect(a.getByText(strings.feed_empty)).toBeVisible();

  await a.getByRole("button", { name: strings.post_compose_prompt }).click();
  const dialog = a.getByRole("dialog");
  const where = dialog.getByLabel(strings.feed_compose_target);
  await expect(where).toHaveValue("");
  await expect(where.locator("option")).toHaveText([strings.feed_target_wall, name]);
  await expect(dialog.getByRole("radio", { name: strings.wall_audience_friends })).toBeChecked();
  await expect(dialog.getByText(strings.wall_not_encrypted_notice, { exact: true })).toBeVisible();
  await dialog.getByLabel(strings.post_compose).fill("Á vegginn");
  await dialog.getByRole("button", { name: strings.post_publish }).click();
  await expect(dialog).toHaveCount(0);
  const onWall = post(a, "Á vegginn");
  await expect(onWall).toBeVisible();
  await expect(onWall.locator('[data-audience="friends"]')).toBeVisible();
  await expect(onWall.locator('a[href^="/communities/"]')).toHaveCount(0);

  // A community instead: the audience choice and the wall's notice go away.
  await a.getByRole("button", { name: strings.post_compose_prompt }).click();
  await where.selectOption({ label: name });
  await expect(dialog.getByRole("radio", { name: strings.wall_audience_friends })).toHaveCount(0);
  await expect(dialog.getByText(strings.wall_not_encrypted_notice, { exact: true })).toHaveCount(0);
  await dialog.getByLabel(strings.post_compose).fill("Í félagið");
  await dialog.getByRole("button", { name: strings.post_publish }).click();
  await expect(dialog).toHaveCount(0);
  const inCommunity = post(a, "Í félagið");
  await expect(inCommunity).toBeVisible();
  await expect(inCommunity.locator(`a[href="/communities/${idOf(community)}"]`)).toContainText(
    name,
  );
});

test("pages follow the cursor to the end of the list", async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await person(browser, "Auður Prófsdóttir");
  const community = await found(a, "open");
  for (let n = 1; n <= 5; n++) {
    expect(
      await send(a, "POST", `/v1/communities/${idOf(community)}/posts`, { body: `Röð ${n}` }),
    ).toBe(200);
  }
  // Two posts a page, so five take three requests.
  const cursors: string[] = [];
  await a.route("**/v1/home*", (route) => {
    const url = new URL(route.request().url());
    cursors.push(url.searchParams.get("before") ?? "first");
    url.searchParams.set("limit", "2");
    return route.fallback({ url: url.toString() });
  });
  await openFeed(a);
  // The next page loads when the end of the list scrolls into view.
  await a.mouse.move(400, 400);
  for (let n = 5; n >= 1; n--) {
    await expect(async () => {
      await a.mouse.wheel(0, 4000);
      await expect(post(a, `Röð ${n}`)).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
  }
  expect(cursors.length).toBeGreaterThanOrEqual(3);
  // Three pages of two take three distinct cursors; no post is listed twice.
  expect(new Set(cursors).size).toBeGreaterThanOrEqual(3);
  for (let n = 1; n <= 5; n++) await expect(post(a, `Röð ${n}`)).toHaveCount(1);
});

test("an empty page with more after it is followed, not shown as an empty feed", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const a = await person(browser, "Auður Prófsdóttir");
  const community = await found(a, "open");
  for (const n of [1, 2]) {
    expect(
      await send(a, "POST", `/v1/communities/${idOf(community)}/posts`, { body: `Eftir ${n}` }),
    ).toBe(200);
  }
  // A real cursor, behind the newest post, for the page that comes back empty.
  const cursor = await a.evaluate(async (headers) => {
    const answer = await fetch("/v1/home?limit=1", { headers });
    const body: { next: string | null } = await answer.json();
    return body.next;
  }, CLIENT);
  expect(cursor).not.toBeNull();

  // The empty page is answered at once; the page behind it is held, so the screen
  // between the two can be looked at: it is a wait, not an empty feed.
  let first = true;
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let followed = () => {};
  const sawFollow = new Promise<void>((resolve) => (followed = resolve));
  await a.route("**/v1/home*", async (route) => {
    if (!first) {
      followed();
      await held;
      return route.fallback();
    }
    first = false;
    return route.fulfill({ json: { posts: [], next: cursor } });
  });
  await openFeed(a);
  await sawFollow;
  await expect(a.getByText(strings.feed_empty)).toHaveCount(0);
  release();
  await expect(post(a, "Eftir 1")).toBeVisible();
  await expect(a.getByText(strings.feed_empty)).toHaveCount(0);
  expect(first, "the empty page was served").toBe(false);
});

test("five tabs fit at 320 and 360 px, each inside the screen", async ({ browser }) => {
  const a = await person(browser, "Auður Prófsdóttir");
  for (const width of [320, 360]) {
    await a.setViewportSize({ width, height: 700 });
    await openFeed(a);
    const nav = a.getByRole("navigation", { name: strings.main_navigation });
    const links = nav.getByRole("link");
    await expect(links).toHaveCount(5);
    await expect(links.first()).toContainText(strings.tab_feed);
    const boxes = await links.evaluateAll((all) =>
      all.map((link) => {
        const { left, right } = link.getBoundingClientRect();
        return { left, right };
      }),
    );
    for (const [index, box] of boxes.entries()) {
      expect(box.left, `tab ${index} at ${width}`).toBeGreaterThanOrEqual(0);
      expect(box.right, `tab ${index} at ${width}`).toBeLessThanOrEqual(width);
      if (index > 0) expect(box.left).toBeGreaterThanOrEqual(boxes[index - 1]!.right - 0.5);
    }
    expect(await pageOverflow(a)).toBeLessThanOrEqual(0);
    expect(await layoutWidth(a)).toBeLessThanOrEqual(width);
  }
});
