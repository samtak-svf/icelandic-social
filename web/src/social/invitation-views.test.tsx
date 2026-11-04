import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CommunityInvitation } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { InvitedAnswer } from "./community-membership.tsx";
import { InvitationView } from "./invitations-pending.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

/** The onClick of the first element in the tree whose only child is `label`. */
function clickOf(node: ReactNode, label: string): (() => void) | undefined {
  if (!isValidElement(node)) return undefined;
  const el = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  if (el.props.children === label) return el.props.onClick;
  for (const child of [el.props.children].flat()) {
    const found = clickOf(child, label);
    if (found) return found;
  }
  return undefined;
}

describe("InvitedAnswer", () => {
  const props = { busy: false, suspended: false, accept: vi.fn(), decline: vi.fn() };

  it("names the inviter, and a deleted one by the deleted-person word", () => {
    const named = renderToStaticMarkup(
      <InvitedAnswer {...props} by={{ accountId: "a", name: "Garðar Pálsson" }} />,
    );
    expect(named).toContain(strings.community_invited_by({ name: "Garðar Pálsson" }));
    const gone = renderToStaticMarkup(
      <InvitedAnswer {...props} by={{ accountId: "a", name: null }} />,
    );
    expect(gone).toContain(strings.community_invited_by({ name: strings.person_deleted }));
  });

  it("asks without a name when the invitation records no inviter, and offers no join request", () => {
    const html = renderToStaticMarkup(<InvitedAnswer {...props} by={null} />);
    expect(html).toContain(strings.community_invited);
    expect(html).not.toContain(strings.community_request_join);
  });

  it("wires accept and decline to their own handlers", () => {
    const accept = vi.fn();
    const decline = vi.fn();
    const tree = InvitedAnswer({ ...props, by: null, accept, decline });
    clickOf(tree, strings.community_accept_invite)?.();
    expect([accept.mock.calls.length, decline.mock.calls.length]).toEqual([1, 0]);
    clickOf(tree, strings.community_decline_invite)?.();
    expect([accept.mock.calls.length, decline.mock.calls.length]).toEqual([1, 1]);
  });
});

describe("InvitationView", () => {
  const invitation = (change: Partial<CommunityInvitation> = {}): CommunityInvitation => ({
    accountId: "b",
    name: "Anna Jónsdóttir",
    invitedBy: { accountId: "a", name: "Garðar Pálsson" },
    createdAt: Date.now(),
    ...change,
  });
  const view = (i: CommunityInvitation) =>
    renderToStaticMarkup(
      <InvitationView invitation={i} busy={false} problem={null} withdraw={() => undefined} />,
    );

  it("shows whom it went to, who sent it, and the withdraw button", () => {
    const html = view(invitation());
    expect(html).toContain("Anna Jónsdóttir");
    expect(html).toContain(strings.community_invitation_from({ name: "Garðar Pálsson" }));
    expect(html).toContain(strings.community_withdraw_invite);
  });

  it("leaves the sender line out when the invitation has none", () => {
    const html = view(invitation({ invitedBy: null }));
    expect(html).not.toContain("Garðar");
    expect(html).toContain("Anna Jónsdóttir");
  });

  it("calls withdraw from the button", () => {
    const withdraw = vi.fn();
    const tree = InvitationView({ invitation: invitation(), busy: false, problem: null, withdraw });
    clickOf(tree, strings.community_withdraw_invite)?.();
    expect(withdraw).toHaveBeenCalledOnce();
  });
});
