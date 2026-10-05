import { createApp } from "./app.ts";

export { Conversation } from "./do/conversation.ts";
export { Inbox } from "./do/inbox.ts";

export default {
  fetch: createApp().fetch,
} satisfies ExportedHandler<Env>;
