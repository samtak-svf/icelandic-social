import { useEffect, useState } from "react";
import { strings } from "../generated/brand/strings.ts";
import { FRAME_SPECS, type AnyFrame, type FrameKind, type Framing } from "../generated/frames.ts";
import { Button } from "../ui/kit.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { currentSizeClass } from "../ui/size-class.ts";
import { FrameCropper, FrameHint } from "./frame-cropper.tsx";
import { framingOf, startRect, type Aspect, type FrameRect, type ImageSize } from "./frame-math.ts";
import { ImageProblem } from "./image-problem.tsx";
import type { SendProblem } from "./frame-send.ts";

// The crop sheet (decision 0086). By default it is one window in the shape the
// image has on this screen, with drag, pinch and Save. For a cover only, a
// quiet text link inside it opens every frame at once; it never opens by
// itself and is not a step of the default flow.

const NAMES = {
  compact: () => strings.image_frames_compact,
  medium: () => strings.image_frames_medium,
  expanded: () => strings.image_frames_expanded,
  square: () => strings.image_frames_title,
} as const satisfies Record<AnyFrame, () => string>;

function framesOf(kind: FrameKind): AnyFrame[] {
  return kind === "cover" ? ["compact", "medium", "expanded"] : ["square"];
}

function aspectOf(kind: FrameKind, frame: AnyFrame): Aspect {
  const size = (FRAME_SPECS[kind] as Record<string, { w: number; h: number }>)[frame];
  return { aspectW: size?.w ?? 1, aspectH: size?.h ?? 1 };
}

export function FrameSheet({
  kind,
  source,
  stored,
  save,
  cancel,
}: Readonly<{
  kind: FrameKind;
  /** The master the person frames: the file just chosen, or the one the server kept. */
  source: Blob;
  /** How it is framed now, or null for a new image. */
  stored: Framing | null;
  /** Sends the framing (null when nothing changed); the problem, or null when it went. */
  save: (framing: Framing | null) => Promise<SendProblem | null>;
  cancel: () => void;
}>) {
  const [url, setUrl] = useState<string | null>(null);
  const [image, setImage] = useState<ImageSize | null>(null);
  const [edits, setEdits] = useState<Partial<Record<AnyFrame, FrameRect>>>({});
  const [last, setLast] = useState<AnyFrame | null>(null);
  const [reset, setReset] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SendProblem | null>(null);
  // The frame this screen shows now; read once, so a resize does not move the window under the person.
  const [here] = useState(() => (kind === "cover" ? currentSizeClass() : ("square" as const)));

  useEffect(() => {
    const object = URL.createObjectURL(source);
    let live = true;
    setUrl(object);
    createImageBitmap(source)
      .then((bitmap) => {
        if (live) setImage({ w: bitmap.width, h: bitmap.height });
        bitmap.close();
      })
      .catch(() => {
        if (live) setProblem("invalid_image");
      });
    return () => {
      live = false;
      URL.revokeObjectURL(object);
    };
  }, [source]);

  const framing = framingOf(
    reset ? { focus: stored?.focus ?? { x: 0.5, y: 0.5 } } : stored,
    edits,
    last,
    reset,
  );

  function rectOf(frame: AnyFrame, size: ImageSize): FrameRect {
    return (
      edits[frame] ??
      startRect(size, aspectOf(kind, frame), framing.focus, framing.overrides?.[frame] ?? null)
    );
  }

  function adjust(frame: AnyFrame, rect: FrameRect) {
    setEdits((now) => ({ ...now, [frame]: rect }));
    setLast(frame);
  }

  async function submit() {
    setBusy(true);
    setProblem(null);
    const dirty = reset || last !== null;
    const failed = await save(dirty ? framing : null);
    // On success the host closes the sheet, which unmounts it.
    if (failed !== null) {
      setBusy(false);
      setProblem(failed);
    }
  }

  const frames = advanced ? framesOf(kind) : [here];
  return (
    <Dialog title={strings.image_frames_title} onClose={cancel} wide={advanced}>
      <div className="flex flex-col gap-3">
        {image === null || url === null ? (
          <p role="status">{strings.loading}</p>
        ) : (
          <div
            data-testid="frame-panes"
            className={advanced ? "grid gap-4 medium:grid-cols-3" : "grid"}
          >
            {frames.map((frame) => (
              <div key={frame} className="flex flex-col gap-1">
                {advanced && <p className="font-medium">{NAMES[frame]()}</p>}
                <FrameCropper
                  src={url}
                  image={image}
                  aspect={aspectOf(kind, frame)}
                  rect={rectOf(frame, image)}
                  onChange={(rect) => adjust(frame, rect)}
                  label={advanced ? NAMES[frame]() : strings.image_frames_hint}
                  sliderLabel={strings.image_frames_zoom}
                />
              </div>
            ))}
          </div>
        )}
        <FrameHint />
        {kind === "cover" && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              aria-expanded={advanced}
              onClick={() => setAdvanced(!advanced)}
              className="inline-flex min-h-11 items-center text-sm underline"
            >
              {strings.image_frames_advanced}
            </button>
            {advanced && (
              <Button
                onClick={() => {
                  setEdits({});
                  setLast(null);
                  setReset(true);
                }}
              >
                {strings.image_frames_reset}
              </Button>
            )}
          </div>
        )}
        <ImageProblem problem={problem} />
        <div className="flex justify-end gap-3">
          <Button onClick={cancel} disabled={busy}>
            {strings.cancel}
          </Button>
          <Button tone="primary" onClick={() => void submit()} disabled={busy || image === null}>
            {strings.save}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
