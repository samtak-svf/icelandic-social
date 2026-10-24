import { strings } from "../src/generated/brand/strings.ts";
import { SIZE_CLASSES } from "../src/generated/frames.ts";
import { layoutOf } from "../src/ui/layout.ts";
import { expect, test } from "./origin.ts";
import { found, join, person, write } from "./social-helpers.ts";

// The hub and Stofna samfélag at the contract's size classes (decision 0087):
// on an expanded window the reader's communities sit in a column beside the
// feed, each with its unread count, and the create form sits beside a live
// preview of the community header; below it the tabs and the bare form stay.

const WIDTHS = [412, SIZE_CLASSES.expanded - 1, SIZE_CLASSES.expanded, 1440];

test("the hub's column and the create preview appear only on an expanded window", async ({
  browser,
}) => {
  test.slow();
  const owner = await person(browser, "Eigandi Hubdal");
  const community = await found(owner, "open");
  const name = (await owner.getByRole("main").getByRole("heading", { level: 1 }).textContent())!;
  // Someone else posts, so the community has one post the owner has not seen.
  const member = await person(browser, "Félagi Hubdal");
  await join(member, community);
  await write(member, strings.post_compose, strings.post_publish, "Fyrsta færsla í hubbinu.");
  await member.context().close();

  for (const width of WIDTHS) {
    const layout = layoutOf(width);
    await owner.setViewportSize({ width, height: 700 });

    await owner.goto(new URL("/communities", community).href);
    const main = owner.getByRole("main");
    const tabs = main.getByRole("group", { name: strings.tab_communities });
    const column = main.getByRole("complementary", { name: strings.communities_mine });
    const feed = main.getByRole("region", { name: strings.communities_tab_feed });
    await expect(main.getByRole("heading", { level: 1 })).toBeVisible();

    if (layout.hub === "tabs") {
      await expect(column).toBeHidden();
      await expect(tabs).toBeVisible();
    } else {
      await expect(tabs).toBeHidden();
      await expect(column).toBeVisible();
      await expect(column.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
      await expect(column.getByText(strings.community_new_posts({ count: 1 }))).toBeVisible();
      await expect(
        column.getByRole("link", { name: new RegExp(`^${strings.community_create}`) }),
      ).toBeVisible();
      await expect(feed).toBeVisible();
      const feedBox = (await feed.boundingBox())!;
      const columnBox = (await column.boundingBox())!;
      expect(columnBox.x).toBeGreaterThanOrEqual(feedBox.x + feedBox.width);
      expect(columnBox.y).toBeLessThan(feedBox.y + feedBox.height);
      expect(await owner.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    }

    // The create page: the preview carries the typed name only beside the form.
    await owner.goto(new URL("/communities/new", community).href);
    const typed = `Forskoðun ${width}`;
    await owner.getByLabel(strings.community_name).fill(typed);
    const preview = owner
      .getByRole("main")
      .getByRole("region", { name: strings.community_preview });
    if (layout.create === "form") {
      await expect(preview).toBeHidden();
    } else {
      await expect(preview).toBeVisible();
      await expect(preview.getByRole("heading", { name: typed })).toBeVisible();
      const form = (await owner.getByLabel(strings.community_name).boundingBox())!;
      const previewBox = (await preview.boundingBox())!;
      expect(previewBox.x).toBeGreaterThanOrEqual(form.x + form.width);
      await owner.getByLabel(strings.community_name).fill(`${typed} breytt`);
      await expect(preview.getByRole("heading", { name: `${typed} breytt` })).toBeVisible();
    }
  }
});
