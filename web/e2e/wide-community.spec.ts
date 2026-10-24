import { strings } from "../src/generated/brand/strings.ts";
import { SIZE_CLASSES } from "../src/generated/frames.ts";
import { layoutOf } from "../src/ui/layout.ts";
import { expect, test } from "./origin.ts";
import { found, join, person, post, write } from "./social-helpers.ts";

// The community page at the contract's size classes (decision 0087): the
// header shows as many members' pictures as the layout allows, and on an
// expanded window Um samfélagið sits beside the feed, in view while it scrolls.

const WIDTHS = [
  412,
  SIZE_CLASSES.medium - 1,
  SIZE_CLASSES.medium,
  SIZE_CLASSES.expanded - 1,
  SIZE_CLASSES.expanded,
  1440,
];
const DESCRIPTION = "Við ræktum grænmeti saman á vorin.";
const JOINED = ["Arnar", "Birna", "Dagur", "Elín", "Fannar"];

test("the header's pictures and the aside follow the layout at every width", async ({
  browser,
}) => {
  // Six people sign in and join before the page is measured.
  test.slow();
  const owner = await person(browser, "Eigandi Breiðdal");
  const community = await found(owner, "open", DESCRIPTION);
  for (const first of JOINED) {
    const member = await person(browser, `${first} Breiðdal`);
    await join(member, community);
    await member.context().close();
  }
  for (let i = 0; i < 3; i++) {
    await write(owner, strings.post_compose, strings.post_publish, `Færsla ${i + 1} í breiðu.`);
  }
  const everyone = JOINED.length + 1;

  for (const width of WIDTHS) {
    await owner.setViewportSize({ width, height: 600 });
    await owner.goto(community);
    const layout = layoutOf(width);
    const main = owner.getByRole("main");
    const header = main.locator("header").first();
    const stack = header.getByRole("list", { name: strings.community_members_stack });
    const aside = main.getByRole("complementary", { name: strings.community_info });
    await expect(main.getByRole("heading", { level: 1 })).toBeVisible();

    if (layout.community === "column") {
      await expect(stack.getByRole("listitem").filter({ visible: true })).toHaveCount(
        Math.min(everyone, layout.memberPictures),
      );
      await expect(header.getByText(DESCRIPTION)).toBeVisible();
      await expect(aside).toBeHidden();
      continue;
    }

    // Beside the feed: the facts and the pictures leave the header for the aside.
    await expect(stack).toBeHidden();
    await expect(header.getByText(DESCRIPTION)).toBeHidden();
    await expect(aside).toBeVisible();
    await expect(aside.getByText(DESCRIPTION)).toBeVisible();
    await expect(aside.getByText(strings.residency_claim)).toBeVisible();
    await expect(
      aside.getByRole("list", { name: strings.community_members_stack }).getByRole("listitem"),
    ).toHaveCount(Math.min(everyone, layout.memberPictures));
    const feed = (await header.boundingBox())!;
    const beside = (await aside.boundingBox())!;
    expect(beside.x).toBeGreaterThanOrEqual(feed.x + feed.width);
    expect(beside.y).toBeLessThan(feed.y + feed.height);
    expect(await owner.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);

    // It stays where it is while the feed scrolls under it.
    await expect(post(owner, "Færsla 1 í breiðu.")).toBeVisible();
    const before = beside.y;
    await owner.evaluate(() => window.scrollBy(0, 400));
    expect(await owner.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect((await aside.boundingBox())!.y).toBeCloseTo(before, 0);
  }
});
