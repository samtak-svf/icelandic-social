// The poll half of the post form (decision 0090): the limits mirror the API's
// `POLL_OPTIONS`, and the helpers are pure so they can be tested without a DOM.

export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 6;
export const POLL_OPTION_MAX = 80;

/** An option's length as the API's schema counts it: code points. */
function pollOptionLength(option: string): number {
  return Array.from(option).length;
}

/** What a field keeps of [text]: `maxLength` counts UTF-16, so it would stop an emoji option at half the limit. */
export function cappedOption(text: string): string {
  return Array.from(text).slice(0, POLL_OPTION_MAX).join("");
}

/** Two empty fields, where a poll starts. */
export function emptyPoll(): string[] {
  return Array.from({ length: POLL_MIN_OPTIONS }, () => "");
}

/** The options as the API takes them: trimmed. */
export function pollOptions(fields: readonly string[]): string[] {
  return fields.map((field) => field.trim());
}

/** A poll needs its question, two to six options, none empty, none the same as another. */
export function canPublishPoll(question: string, fields: readonly string[]): boolean {
  const options = pollOptions(fields);
  if (question.trim() === "") return false;
  if (options.length < POLL_MIN_OPTIONS || options.length > POLL_MAX_OPTIONS) return false;
  if (options.some((option) => option === "" || pollOptionLength(option) > POLL_OPTION_MAX))
    return false;
  return new Set(options.map((option) => option.toLowerCase())).size === options.length;
}
