import type { Conversation, Person } from "../generated/core.d.ts";
import { Avatar } from "../social/avatar.tsx";
import { useGroupPhoto } from "./group-photo.ts";
import { conversationTitle, isGroup } from "./people.ts";

/** A group's circle carries the group's title, a 1:1's the other person. */
export function personFace(conversation: Conversation): Person | null {
  const [only] = conversation.members;
  return isGroup(conversation) || only === undefined ? null : only;
}

/**
 * The picture of a conversation, one for the row, the header and the info
 * page: a group's own photo or the initials of its title, a 1:1's the other
 * person's account photo.
 */
export function ConversationAvatar({
  conversation,
  className,
}: Readonly<{ conversation: Conversation; className: string }>) {
  const photo = useGroupPhoto(conversation);
  const face = personFace(conversation);
  return (
    <Avatar
      kind="person"
      id={face?.account ?? conversation.id}
      name={face === null ? conversationTitle(conversation) : face.name}
      photo={face?.photo ?? null}
      local={photo}
      className={className}
    />
  );
}
