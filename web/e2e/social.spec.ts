import { strings } from "../src/generated/brand/strings.ts";
import { png } from "./images.ts";
import {
  cardMenu,
  expectMember,
  found,
  join,
  manage,
  openComposer,
  openHubFeed,
  pageOverflow,
  person,
  platformModerator,
  post,
  runJobs,
  write,
} from "./social-helpers.ts";
import { CLIENT, expect, test, WEB } from "./origin.ts";

// The first social slice on the web (#291), through what a person sees: a
// member finds and joins a community, posts, comments, reacts, is told of a
// comment and reports a post; the owner, the community's moderator, reviews
// the report and hides the post, and its author is told.

/** Goes to Stjórna through the `⋯` menu. */
test("a member joins, posts, comments, reacts, is told and reports; a moderator acts", async ({
  browser,
}) => {
  // Three browsers through one story: it took 28.9 s of the default 30 on a
  // healthy runner, so a slow one timed it out.
  test.slow();
  const owner = await person(browser, "Eigandi Prófsdóttir");
  const member = await person(browser, "Meðlimur Prófsson");
  const spammer = await person(browser, "Ruslari Prófsson");
  const name = `Garðyrkjufélagið ${crypto.randomUUID().slice(0, 8)}`;

  // The owner creates an open community.
  await owner.getByRole("link", { name: strings.tab_communities }).click();
  await owner.getByRole("link", { name: new RegExp(`^${strings.community_create}`) }).click();
  await owner.getByLabel(strings.community_name).fill(name);
  await owner.getByLabel(strings.community_description).fill("Allt um garða.");
  await owner.getByRole("button", { name: strings.community_create }).click();
  await expect(owner.getByRole("heading", { level: 1, name })).toBeVisible();
  const community = owner.url();

  // The tab of the page the reader is on returns to the tab's root (#356).
  await owner.getByRole("link", { name: strings.tab_communities }).click();
  await expect(owner).toHaveURL(/\/communities$/);
  await owner.goto(community);

  // The member finds it by name and joins.
  for (const one of [member, spammer]) {
    await one.getByRole("link", { name: strings.tab_communities }).click();
    // The search sits behind the icon in the hub's header (0080).
    await one.getByRole("button", { name: strings.communities_find }).first().click();
    await one.getByRole("searchbox").fill(name.slice(0, 18));
    await one.getByRole("button", { name: strings.communities_find }).last().click();
    // The found list and the browse list under it both hold the row.
    await one
      .getByRole("link", { name: new RegExp(name) })
      .first()
      .click();
    await one.getByRole("button", { name: strings.community_join }).click();
    await expectMember(one);
  }

  // The member posts and reacts to their own post.
  await write(member, strings.post_compose, strings.post_publish, "Tómatarnir eru komnir upp.");
  const mine = post(member, "Tómatarnir");
  const like = mine.getByRole("button", { name: strings.post_like, exact: true });
  await like.click();
  await expect(mine.getByText(strings.reaction_count({ count: 1 }))).toBeVisible();

  // Liked, the button reads as the quick-bar reaction it holds. The pointer leaves it first,
  // or resting there opens the quick bar, which has a button of the same name.
  await member.mouse.move(0, 0);
  const liked = mine.getByRole("button", { name: strings.reaction_like, exact: true });
  // Any emoji is a reaction (decision 0100): the plus of the quick bar opens the full picker.
  await liked.press("ArrowUp");
  await mine.getByRole("button", { name: strings.post_reactions_all, exact: true }).click();
  await mine.getByRole("button", { name: "🎉", exact: true }).click();
  // An emoji outside the quick bar shows as its glyph on Líkar, which stays pressed.
  await expect(like).toHaveAttribute("aria-pressed", "true");
  await expect(like).toContainText("🎉");
  await expect(mine.getByText(strings.reaction_count({ count: 1 }))).toBeVisible();

  // The owner comments on it.
  await owner.goto(community);
  await post(owner, "Tómatarnir")
    .getByRole("link", { name: strings.post_comment_action, exact: true })
    .click();
  await write(owner, strings.comment_compose, strings.comment_publish, "Glæsilegt!");
  await expect(owner.getByText("Glæsilegt!")).toBeVisible();

  // The member is told, opens the post from the notification and replies.
  await runJobs();
  await member.reload();
  const bell = member.getByRole("link", { name: new RegExp(strings.notifications_title) });
  await expect(bell).toContainText(strings.notifications_unread({ count: 1 }));
  await bell.click();
  const notice = strings.notice_comment({ name: "Eigandi Prófsdóttir" });
  await member.getByRole("link", { name: new RegExp(notice) }).click();
  await expect(member.getByText("Glæsilegt!")).toBeVisible();
  await write(member, strings.comment_compose, strings.comment_publish, "Takk fyrir!");
  await expect(member.getByText("Takk fyrir!")).toBeVisible();
  await expect(bell).not.toContainText(strings.notifications_unread({ count: 1 }));

  // Someone else posts spam, and the member reports it.
  await spammer.reload();
  await write(spammer, strings.post_compose, strings.post_publish, "Ódýr úr, smelltu hér.");
  await member.goto(community);
  const spam = post(member, "Ódýr úr");
  await cardMenu(spam, strings.report);
  await spam.getByLabel(strings.report_reason_spam).check();
  await spam.getByRole("button", { name: strings.report_send }).click();
  await expect(spam.getByText(strings.report_sent)).toBeVisible();

  // The owner reviews the report and hides the post.
  await owner.goto(community);
  await manage(owner);
  await owner.getByRole("link", { name: strings.moderation_queue }).click();
  const report = owner.getByRole("article", { name: strings.report_reason_spam });
  await expect(report).toContainText("Ódýr úr");
  await report.getByLabel(strings.report_reason).fill("Ruslpóstur");
  await report.getByRole("button", { name: strings.moderation_hide }).click();
  await expect(owner.getByText(strings.moderation_queue_empty)).toBeVisible();

  // The member no longer sees it, and its author is told.
  await member.reload();
  await expect(post(member, "Tómatarnir")).toBeVisible();
  await expect(post(member, "Ódýr úr")).toHaveCount(0);
  await runJobs();
  await spammer.getByRole("link", { name: new RegExp(strings.notifications_title) }).click();
  await expect(spammer.getByText(strings.notice_moderated)).toBeVisible();
});

test("a member posts images, deletes a comment and the post, and withdraws a join request", async ({
  browser,
}) => {
  const owner = await person(browser, "Eigandi Myndadóttir");
  const member = await person(browser, "Meðlimur Myndason");
  const open = await found(owner, "open");
  await join(member, open);

  // Five images, or one over 10 MB, are refused before any upload.
  const image = { name: "mynd.png", mimeType: "image/png", buffer: await png(member) };
  await openComposer(member);
  const pick = member.getByRole("dialog").getByLabel(strings.post_add_images);
  await pick.setInputFiles([1, 2, 3, 4, 5].map((n) => ({ ...image, name: `mynd${n}.png` })));
  await expect(member.getByText(strings.post_images_too_many)).toBeVisible();
  const large = Buffer.alloc(10 * 1024 * 1024 + 1);
  await pick.setInputFiles({ name: "stor.png", mimeType: "image/png", buffer: large });
  await expect(member.getByText(strings.post_image_too_large)).toBeVisible();

  // Two are taken, uploaded with the post and shown in it.
  await pick.setInputFiles([image, { ...image, name: "mynd2.png" }]);
  await expect(member.getByText("mynd2.png")).toBeVisible();
  await expect(member.getByText(strings.post_image_too_large)).toHaveCount(0);
  await write(member, strings.post_compose, strings.post_publish, "Myndir úr garðinum.");
  await expect(member.getByText("mynd2.png")).toHaveCount(0);
  const mine = post(member, "Myndir úr garðinum");
  // Two are told apart by their number (#355).
  const images = mine.getByRole("img");
  await expect(images).toHaveCount(2);
  for (const n of [1, 2]) {
    await expect(
      mine.getByRole("img", { name: strings.post_image_alt_numbered({ n, count: 2 }) }),
    ).toBeVisible();
  }
  for (const one of await images.all()) {
    await expect
      .poll(() => one.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
  }
  // Someone else sees them too, and has no delete on another's post.
  await owner.goto(open);
  await expect(post(owner, "Myndir úr garðinum").getByRole("img")).toHaveCount(2);
  await post(owner, "Myndir úr garðinum")
    .getByRole("button", { name: strings.more_options })
    .click();
  await expect(owner.getByRole("menuitem", { name: strings.delete })).toHaveCount(0);
  await owner.keyboard.press("Escape");

  // The member comments, then deletes the comment and the post, after confirming.
  await mine.getByRole("link", { name: strings.post_comment_action, exact: true }).click();
  await write(member, strings.comment_compose, strings.comment_publish, "Gleymdi einu.");
  const comment = post(member, "Gleymdi einu.");
  member.once("dialog", (dialog) => void dialog.accept());
  await comment.getByRole("button", { name: strings.delete }).click();
  await expect(comment).toHaveCount(0);
  await expect(member.getByText(strings.comments_empty)).toBeVisible();
  member.once("dialog", (dialog) => void dialog.accept());
  await cardMenu(post(member, "Myndir úr garðinum"), strings.delete);
  await member.waitForURL(open);
  await expect(member.getByText(strings.posts_empty)).toBeVisible();

  // A request to join a private community is withdrawn.
  const closed = await found(owner, "private");
  await member.goto(closed);
  await member.getByRole("button", { name: strings.community_request_join }).click();
  await expect(member.getByText(strings.community_join_requested)).toBeVisible();
  await member.getByRole("button", { name: strings.community_withdraw_request }).click();
  await expect(member.getByText(strings.community_join_requested)).toHaveCount(0);
  await expect(member.getByRole("button", { name: strings.community_request_join })).toBeVisible();
});

test("a moderator hides, then restores and mutes and unmutes from the closed reports", async ({
  browser,
}) => {
  // Three sign-ins take most of the default 30 s on a busy runner.
  test.slow();
  const owner = await person(browser, "Eigandi Stjórnadóttir");
  const writer = await person(browser, "Höfundur Stjórnason");
  const reader = await person(browser, "Lesandi Stjórnason");
  const community = await found(owner, "open");
  await join(writer, community);
  await join(reader, community);

  await write(writer, strings.post_compose, strings.post_publish, "Kaupið ódýra áburðinn.");
  await reader.reload();
  const spam = post(reader, "ódýra áburðinn");
  await cardMenu(spam, strings.report);
  await spam.getByLabel(strings.report_reason_spam).check();
  await spam.getByRole("button", { name: strings.report_send }).click();
  await expect(spam.getByText(strings.report_sent)).toBeVisible();

  // Hiding closes the report; the closed side holds it.
  await owner.goto(community);
  await manage(owner);
  await owner.getByRole("link", { name: strings.moderation_queue }).click();
  const open = owner.getByRole("article", { name: strings.report_reason_spam });
  await open.getByLabel(strings.report_reason).fill("Ruslpóstur");
  await open.getByRole("button", { name: strings.moderation_hide }).click();
  await expect(owner.getByText(strings.moderation_queue_empty)).toBeVisible();
  await reader.reload();
  await expect(post(reader, "ódýra áburðinn")).toHaveCount(0);

  const closedSide = owner.getByRole("button", { name: strings.moderation_closed, exact: true });
  await closedSide.click();
  await expect(closedSide).toHaveAttribute("aria-pressed", "true");
  const closed = owner.getByRole("article", { name: strings.report_reason_spam });
  await expect(closed).toContainText("ódýra áburðinn");
  await expect(closed.getByRole("button", { name: strings.moderation_dismiss })).toHaveCount(0);
  // It says what was decided, why and by whom (#360), and offers no second hide (#361).
  await expect(closed.getByText(strings.moderation_decision_hide_post)).toBeVisible();
  await expect(closed.getByText("Ruslpóstur", { exact: true })).toBeVisible();
  await expect(closed.getByText(/^Eigandi Stjórnadóttir afgreiddi tilkynninguna /)).toBeVisible();
  await expect(closed.getByRole("button", { name: strings.moderation_hide })).toHaveCount(0);
  await expect(closed.getByRole("button", { name: strings.moderation_unmute })).toHaveCount(0);
  await closed.getByLabel(strings.report_reason).fill("Ekki ruslpóstur eftir allt");

  /** Presses a moderator's action and waits until the server has done it. */
  const act = async (label: string) => {
    const done = owner.waitForResponse(
      (answer) => answer.url().endsWith("/actions") && answer.status() === 204,
    );
    await closed.getByRole("button", { name: label }).click();
    await done;
    await expect(closed.getByText(strings.moderation_done)).toBeVisible();
  };

  // Restored, the reader sees it again.
  await act(strings.moderation_restore);
  await reader.reload();
  await expect(post(reader, "ódýra áburðinn")).toBeVisible();

  // Muted, the writer reads but does not write; unmuted, writes again.
  await act(strings.moderation_mute);
  await writer.reload();
  await expect(writer.getByText(strings.community_muted)).toBeVisible();
  await expect(writer.getByRole("button", { name: strings.post_compose_prompt })).toHaveCount(0);
  await act(strings.moderation_unmute);
  await writer.reload();
  await expect(writer.getByRole("button", { name: strings.post_compose_prompt })).toBeVisible();
  await expect(writer.getByText(strings.community_muted)).toHaveCount(0);

  // The open side is empty still.
  await owner.getByRole("button", { name: strings.moderation_open, exact: true }).click();
  await expect(owner.getByText(strings.moderation_queue_empty)).toBeVisible();
});

test("a moderator approves one join request and declines another, who must wait", async ({
  browser,
}) => {
  test.slow();
  const owner = await person(browser, "Eigandi Beiðnadóttir");
  const welcome = await person(browser, "Velkomin Beiðnadóttir");
  const refused = await person(browser, "Hafnað Beiðnason");
  const community = await found(owner, "private");
  for (const one of [welcome, refused]) {
    await one.goto(community);
    await one.getByRole("button", { name: strings.community_request_join }).click();
    await expect(one.getByText(strings.community_join_requested)).toBeVisible();
  }

  // The owner sees how many wait, and answers each.
  await owner.reload();
  await manage(owner);
  // The side navigation of an expanded window (decision 0087) says how many wait.
  const requests = owner.getByRole("link", { name: strings.join_requests_title });
  await expect(requests).toHaveText(`${strings.join_requests_title}2`);
  await requests.click();
  await expect(owner.getByRole("heading", { name: strings.join_requests_title })).toBeVisible();
  const request = (name: string) => owner.getByRole("article").filter({ hasText: name });
  await expect(request("Velkomin").getByText(strings.verified_short)).toBeVisible();
  await request("Velkomin").getByRole("button", { name: strings.join_request_approve }).click();
  await expect(request("Velkomin")).toHaveCount(0);
  await request("Hafnað").getByRole("button", { name: strings.join_request_decline }).click();
  await expect(owner.getByText(strings.join_requests_empty)).toBeVisible();

  // One is a member; the other is told, and offered no way to ask again yet.
  await welcome.reload();
  await expectMember(welcome);
  await refused.reload();
  await expect(refused.getByText(strings.community_join_declined)).toBeVisible();
  await expect(refused.getByText(/^Þú getur beðið aftur \d+\. \p{L}+ \d{4}\.$/u)).toBeVisible();
  await expect(refused.getByRole("button", { name: strings.community_request_join })).toHaveCount(
    0,
  );
});

test("the owner deletes a community, and a platform moderator restores it", async ({ browser }) => {
  test.slow();
  const owner = await person(browser, "Eigandi Eyðingardóttir");
  const platform = await person(browser, "Umsjón Eyðingarson");
  await platformModerator(platform);
  const community = await found(owner, "open");
  const name = (await owner.getByRole("heading", { level: 1 }).textContent()) ?? "";
  await write(owner, strings.post_compose, strings.post_publish, "Síðasti pósturinn.");

  // The confirmation names it; once accepted, it is gone for the owner.
  let asked = "";
  owner.once("dialog", (dialog) => {
    asked = dialog.message();
    void dialog.accept();
  });
  await manage(owner);
  await owner.getByRole("button", { name: strings.community_delete }).click();
  await owner.waitForURL(/\/communities$/);
  expect(asked).toBe(strings.community_delete_confirm({ name }));
  await expect(owner.getByRole("link", { name })).toHaveCount(0);
  await owner.goto(community);
  await expect(owner.getByRole("heading", { name })).toHaveCount(0);

  // A platform moderator sees it deleted, with its last day, and restores it.
  await platform.goto(community);
  const notice = strings.community_deleted_notice({ date: "" }).replace(/\.$/, "");
  await expect(platform.getByText(notice)).toBeVisible();
  await expect(platform.getByText("Síðasti pósturinn.")).toHaveCount(0);
  await platform.getByRole("button", { name: strings.community_restore }).click();
  await expect(platform.getByRole("button", { name: strings.community_join })).toBeVisible();
  await owner.goto(community);
  await expect(post(owner, "Síðasti pósturinn.")).toBeVisible();
});

test("renders the shell while /v1/me waits, fits a 390px screen on /communities, and headings /posts", async ({
  browser,
}) => {
  const member = await person(browser, "Símasjá Skoðunardóttir");
  const community = await found(member, "open");
  await write(member, strings.post_compose, strings.post_publish, "Póstur á litlum skjá.");
  await member.setViewportSize({ width: 390, height: 844 });

  let releaseMe!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseMe = resolve;
  });
  await member.route("**/v1/me", async (route) => {
    await gate;
    await route.fallback();
  });

  await member.goto(`${WEB}/communities`);
  await expect(member.getByRole("navigation", { name: strings.main_navigation })).toBeVisible();
  await expect(
    member.getByRole("heading", { level: 1, name: strings.tab_communities }),
  ).toBeVisible();
  releaseMe();
  await member.unroute("**/v1/me");

  expect(await pageOverflow(member)).toBe(0);

  await member.goto(community);
  await post(member, "Póstur á litlum skjá.")
    .getByRole("link", { name: strings.post_comment_action, exact: true })
    .click();
  await expect(member.getByRole("heading", { level: 1, name: strings.post_title })).toBeAttached();
});

test("a comment is liked and replied to through the one-row composer", async ({ browser }) => {
  const owner = await person(browser, "Spjallari Prófsdóttir");
  const community = await found(owner, "open");
  await write(owner, strings.post_compose, strings.post_publish, "Umræðuefni dagsins.");
  await post(owner, "Umræðuefni dagsins.")
    .getByRole("link", { name: strings.post_comment_action, exact: true })
    .click();

  // The box is one row: the send button waits for text.
  const send = owner.getByRole("button", { name: strings.comment_publish, exact: true });
  await expect(send).toBeDisabled();
  await owner.getByPlaceholder(strings.post_write_comment).fill("Fyrsta athugasemd.");
  await expect(send).toBeEnabled();
  await send.click();
  const first = owner.getByRole("article").filter({ hasText: "Fyrsta athugasemd." });
  await expect(first).toBeVisible();

  // Like it.
  const like = first.getByRole("button", { name: strings.comment_like });
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "true");

  // Reply to it: the bar names who is answered, and the reply lands under it.
  await first.getByRole("button", { name: strings.comment_reply }).click();
  await expect(owner.getByLabel(strings.comment_reply)).toContainText(
    strings.comment_replying_to({ name: "Spjallari Prófsdóttir" }),
  );
  await write(owner, strings.comment_compose, strings.comment_publish, "Svar við því.");
  await expect(owner.getByRole("article").filter({ hasText: "Svar við því." })).toBeVisible();
  await expect(owner.getByLabel(strings.comment_reply)).toHaveCount(0);
  await owner.goto(community);
});

test("the feed shows more than one page of posts after scrolling", async ({ browser }) => {
  test.slow();
  const owner = await person(browser, "Skrunari Prófsdóttir");
  const community = await found(owner, "open");
  const communityId = community.split("/").pop() ?? "";
  const COUNT = 23;
  // Seeded through the API: the page size is 20, so a second page must be read.
  const made = await owner.evaluate(
    async ({ id, count, client }) => {
      let ok = 0;
      for (let n = 1; n <= count; n++) {
        const answer = await fetch(`/v1/communities/${id}/posts`, {
          method: "POST",
          headers: { ...client, "content-type": "application/json" },
          body: JSON.stringify({ body: `Færsla númer ${n}`, media: [] }),
        });
        if (answer.status === 200) ok++;
      }
      return ok;
    },
    { id: communityId, count: COUNT, client: CLIENT },
  );
  expect(made).toBe(COUNT);

  await owner.getByRole("link", { name: strings.tab_communities }).click();
  await openHubFeed(owner);
  const cards = owner
    .getByRole("region", { name: strings.communities_tab_feed })
    .getByRole("article");
  await expect(cards.first()).toBeVisible();
  // Scroll to the end until the oldest post has been read in.
  await expect
    .poll(
      async () => {
        await owner.mouse.wheel(0, 100_000);
        return cards.count();
      },
      { timeout: 20_000 },
    )
    .toBe(COUNT);
  await expect(owner.getByText("Færsla númer 1", { exact: true })).toBeVisible();
});
