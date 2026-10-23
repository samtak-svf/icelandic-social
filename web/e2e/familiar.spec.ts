import { strings } from "../src/generated/brand/strings.ts";
import { expect, test } from "./origin.ts";
import { cardMenu, found, join, person, post, titleOf, write } from "./social-helpers.ts";

// Communities as readers know them (decision 0080), through what a person
// sees: what is new on the hub, pinned communities and posts, a like on a
// comment, and the link a post copies.

test("a hub row counts what is new, and opening the community clears it", async ({ browser }) => {
  const owner = await person(browser, "Eigandi Nýjungadóttir");
  const member = await person(browser, "Meðlimur Nýjungason");
  const community = await found(owner, "open");
  const name = await titleOf(owner);
  await join(member, community);

  await write(owner, strings.post_compose, strings.post_publish, "Fyrsti nýi pósturinn.");
  await write(owner, strings.post_compose, strings.post_publish, "Annar nýi pósturinn.");
  await expect(post(owner, "Annar nýi")).toBeVisible();

  // The feed under the list names the community too, so look in the list alone.
  const mine = member.locator('section[aria-labelledby="mine"]');
  await member.getByRole("link", { name: strings.tab_communities }).click();
  const row = mine.getByRole("link", { name: new RegExp(name) });
  await expect(row).toContainText(strings.community_new_posts({ count: 2 }));
  await row.click();
  await expect(member.getByRole("heading", { name })).toBeVisible();
  await expect(post(member, "Annar nýi")).toBeVisible();

  await member.getByRole("link", { name: strings.tab_communities }).click();
  await expect(row).toBeVisible();
  await expect(mine.getByText(/nýir? póstar?/)).toHaveCount(0);
});

test("a pinned community leads the list, and unpinning gives the place back", async ({
  browser,
}) => {
  const owner = await person(browser, "Eigandi Festudóttir");
  const first = await found(owner, "open");
  const firstName = await titleOf(owner);
  const second = await found(owner, "open");
  const secondName = await titleOf(owner);
  await owner.getByRole("link", { name: strings.tab_communities }).click();
  const rows = owner.locator('section[aria-labelledby="mine"] li');
  await expect(rows).toHaveCount(2);

  // Pin the one that is not first now, so the pin is what moves it.
  const lastName = (await rows.first().textContent())?.includes(firstName) ? secondName : firstName;
  expect([first, second]).toHaveLength(2);
  const row = rows.filter({ hasText: lastName });
  await row.getByRole("button", { name: strings.more_options }).click();
  await row.getByRole("menuitem", { name: strings.community_pin }).click();
  await expect(rows.first()).toContainText(lastName);

  // The pin is on the server: a reload keeps it.
  await owner.reload();
  await expect(rows.first()).toContainText(lastName);
  await rows.first().getByRole("button", { name: strings.more_options }).click();
  await rows.first().getByRole("menuitem", { name: strings.community_unpin }).click();
  await expect(rows.first()).not.toContainText(lastName);
});

test("a moderator pins a post to the top of the feed and takes it back", async ({ browser }) => {
  const owner = await person(browser, "Eigandi Festingardóttir");
  const member = await person(browser, "Meðlimur Festingarson");
  const community = await found(owner, "open");
  await join(member, community);
  await write(member, strings.post_compose, strings.post_publish, "Eldri pósturinn.");
  await expect(post(member, "Eldri")).toBeVisible();
  await write(member, strings.post_compose, strings.post_publish, "Nýrri pósturinn.");
  await expect(post(member, "Nýrri")).toBeVisible();

  // A member is offered no pin.
  await member.getByRole("button", { name: strings.more_options }).first().click();
  await expect(member.getByRole("menuitem", { name: strings.post_pin })).toHaveCount(0);
  await member.keyboard.press("Escape");

  await owner.goto(community);
  const cards = owner.getByRole("article");
  await expect(cards.first()).toContainText("Nýrri");
  await cardMenu(post(owner, "Eldri"), strings.post_pin);
  await expect(cards.first()).toContainText("Eldri");
  await expect(cards.first()).toContainText(strings.post_pinned);
  await expect(owner.getByText(strings.post_pinned)).toHaveCount(1);

  // Everyone sees it first, then unpinned it falls back into the order.
  await member.reload();
  await expect(member.getByRole("article").first()).toContainText(strings.post_pinned);
  await cardMenu(cards.first(), strings.post_unpin);
  await expect(owner.getByText(strings.post_pinned)).toHaveCount(0);
  await expect(cards.first()).toContainText("Nýrri");
});

test("a comment is liked with a count, and the like is taken back", async ({ browser }) => {
  const owner = await person(browser, "Eigandi Likadóttir");
  const member = await person(browser, "Meðlimur Likason");
  const community = await found(owner, "open");
  await join(member, community);
  await write(owner, strings.post_compose, strings.post_publish, "Póstur til að líka við.");
  await post(owner, "Póstur til að líka")
    .getByRole("link", { name: strings.post_comments({ count: 0 }) })
    .click();
  await write(owner, strings.comment_compose, strings.comment_publish, "Athugasemd til að líka.");

  await member.goto(community);
  await post(member, "Póstur til að líka")
    .getByRole("link", { name: strings.post_comments({ count: 1 }) })
    .click();
  const comment = member.getByRole("article").filter({ hasText: "Athugasemd til að líka." });
  const like = comment.getByRole("button", { name: strings.comment_like });
  await expect(like).toHaveAttribute("aria-pressed", "false");
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "true");
  await expect(comment).toContainText("👍 1");

  // The server has it: a reload shows it, and the owner sees the count.
  await member.reload();
  await expect(comment.getByRole("button", { name: strings.comment_like })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "false");
  await expect(comment).not.toContainText("👍");
});

test("Afrita tengil puts the post's address on the clipboard", async ({ browser }) => {
  const member = await person(browser, "Símsjá Tengildóttir", [
    "clipboard-read",
    "clipboard-write",
  ]);
  const community = await found(member, "open");
  await write(member, strings.post_compose, strings.post_publish, "Póstur til að deila.");
  const card = post(member, "Póstur til að deila");
  const href = await card
    .getByRole("link", { name: strings.post_comments({ count: 0 }) })
    .getAttribute("href");
  expect(href).toMatch(/^\/posts\/[^/]+$/);
  await card.getByRole("button", { name: strings.share }).click();
  await card.getByRole("menuitem", { name: strings.post_copy_link }).click();
  await expect(card.getByText(strings.post_link_copied)).toBeVisible();
  const copied = await member.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(`${new URL(community).origin}${href}`);
});

test("Líkar, Athugasemd and Deila take equal thirds of a 360px screen, none spilling into the next", async ({
  browser,
}) => {
  const member = await person(browser, "Mjósjá Skjádóttir");
  await found(member, "open");
  await write(member, strings.post_compose, strings.post_publish, "Póstur á mjóum skjá.");
  await member.setViewportSize({ width: 360, height: 800 });
  const card = post(member, "Póstur á mjóum skjá");
  const actions = [
    card.getByRole("button", { name: strings.post_like, exact: true }),
    card.getByRole("link", { name: strings.post_comment_action }),
    card.getByRole("button", { name: strings.share }),
  ];
  const boxes = await Promise.all(
    actions.map((action) =>
      action.evaluate((element) => {
        const { left, right } = element.getBoundingClientRect();
        return { left, right, spill: element.scrollWidth - element.clientWidth };
      }),
    ),
  );
  const [first] = boxes;
  for (const box of boxes) {
    expect(box.spill).toBeLessThanOrEqual(0);
    expect(box.right - box.left).toBeCloseTo((first?.right ?? 0) - (first?.left ?? 0), 0);
  }
  for (const [before, after] of boxes.slice(0, -1).map((box, i) => [box, boxes[i + 1]] as const)) {
    expect(after?.left ?? 0).toBeGreaterThanOrEqual(before.right - 0.5);
  }
});
