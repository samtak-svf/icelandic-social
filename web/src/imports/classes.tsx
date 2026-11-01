import type { ImportItem, ImportStatus } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";

// The kinds of post an export holds, and what it holds that does not come (decision
// 0127). The person sees all of it before choosing, so the publish holds no surprise.

export type ItemClass = ImportItem["class"];

/** Only the person's own words and images come unless they choose more. */
export const DEFAULT_CLASSES: ReadonlySet<ItemClass> = new Set<ItemClass>(["own"]);

export const CLASS_LABEL: Readonly<Record<ItemClass, string>> = {
  own: strings.imports_class_own,
  link: strings.imports_class_link,
  other_timeline: strings.imports_class_other_timeline,
  hidden: strings.imports_class_hidden,
};

/** One checkbox for each kind of post the file holds. */
export function ClassFields({
  status,
  chosen,
  change,
  disabled,
}: Readonly<{
  status: ImportStatus;
  chosen: ReadonlySet<ItemClass>;
  change: (next: ReadonlySet<ItemClass>) => void;
  disabled: boolean;
}>) {
  function toggle(name: ItemClass, on: boolean) {
    const next = new Set(chosen);
    if (on) next.add(name);
    else next.delete(name);
    change(next);
  }

  return (
    <fieldset className="mt-4 flex flex-col" disabled={disabled}>
      <legend className="text-sm font-medium">{strings.imports_classes_title}</legend>
      {status.classes
        .filter((row) => row.posts > 0)
        .map((row) => (
          <label key={row.class} className="flex min-h-11 items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={chosen.has(row.class)}
              onChange={(event) => toggle(row.class, event.target.checked)}
            />
            <span className="flex flex-col">
              <span>{CLASS_LABEL[row.class]}</span>
              <span className="text-sm text-muted-fg">
                {strings.imports_class_counts({
                  posts: String(row.posts),
                  images: String(row.images),
                })}
              </span>
            </span>
          </label>
        ))}
    </fieldset>
  );
}

/** Every sentence about what stays behind, given what is chosen. */
export function lostLines(status: ImportStatus, chosen: ReadonlySet<ItemClass>): string[] {
  const rows = status.classes.filter((row) => chosen.has(row.class));
  const sum = (read: (row: (typeof rows)[number]) => number) =>
    rows.reduce((total, row) => total + read(row), 0);
  const { videoOnly, foreignOnly, foreignImages, empty } = status.lost;
  const lines: readonly [number, (args: { count: number }) => string][] = [
    [sum((row) => row.videos), strings.imports_lost_videos],
    [sum((row) => row.imagesLost), strings.imports_lost_images],
    [videoOnly, strings.imports_lost_video_only],
    [foreignOnly, strings.imports_lost_foreign_only],
    [foreignImages, strings.imports_lost_foreign_images],
    [empty, strings.imports_lost_empty],
  ];
  return lines.filter(([count]) => count > 0).map(([count, line]) => line({ count }));
}

/** What the file holds that no post will carry. */
export function LostList({
  status,
  chosen,
}: Readonly<{ status: ImportStatus; chosen: ReadonlySet<ItemClass> }>) {
  const lines = lostLines(status, chosen);
  if (lines.length === 0) return null;
  return (
    <div className="mt-4 text-sm">
      <p className="font-medium">{strings.imports_lost_heading}</p>
      <ul className="mt-1 list-disc ps-5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
