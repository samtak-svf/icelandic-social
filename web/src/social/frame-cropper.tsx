import { useEffect, useEffectEvent, useRef } from "react";
import { strings } from "../generated/brand/strings.ts";
import {
  dragRect,
  keyRect,
  MAX_ZOOM,
  startRect,
  zoomOf,
  zoomRect,
  type Aspect,
  type FrameRect,
  type ImageSize,
} from "./frame-math.ts";

// One frame of an image, as the person adjusts it (decision 0086): the image
// behind a window of the frame's shape. Drag moves it, the wheel and two
// fingers zoom, the arrows and + / - do the same from the keyboard, and the
// slider is the same zoom for anyone who cannot pinch. The rectangle is held
// by the caller, in fractions of the image.

type Point = { x: number; y: number };

export function FrameCropper({
  src,
  image,
  aspect,
  rect,
  onChange,
  label,
  sliderLabel,
}: Readonly<{
  src: string;
  image: ImageSize;
  aspect: Aspect;
  rect: FrameRect;
  onChange: (rect: FrameRect) => void;
  /** The window's accessible name. */
  label: string;
  /** The zoom slider's accessible name. */
  sliderLabel: string;
}>) {
  const box = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const whole = startRect(image, aspect, { x: 0.5, y: 0.5 }, null);

  /** A point of the screen as fractions of the window. */
  function anchorOf(point: Point) {
    const bounds = box.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return { u: 0.5, v: 0.5 };
    return {
      u: Math.min(1, Math.max(0, (point.x - bounds.left) / bounds.width)),
      v: Math.min(1, Math.max(0, (point.y - bounds.top) / bounds.height)),
    };
  }

  function move(event: React.PointerEvent) {
    const known = pointers.current;
    const before = known.get(event.pointerId);
    const bounds = box.current?.getBoundingClientRect();
    if (before === undefined || !bounds) return;
    const now = { x: event.clientX, y: event.clientY };
    if (known.size === 1) {
      known.set(event.pointerId, now);
      onChange(
        dragRect(rect, now.x - before.x, now.y - before.y, { w: bounds.width, h: bounds.height }),
      );
      return;
    }
    if (known.size !== 2) return;
    const other = [...known.entries()].find(([id]) => id !== event.pointerId)?.[1];
    if (other === undefined) return;
    const was = Math.hypot(before.x - other.x, before.y - other.y);
    const is = Math.hypot(now.x - other.x, now.y - other.y);
    known.set(event.pointerId, now);
    if (was === 0 || is === 0) return;
    const centre = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
    const anchor = anchorOf(centre);
    const shift = { x: (now.x - before.x) / 2, y: (now.y - before.y) / 2 };
    onChange(
      dragRect(zoomRect(rect, image, aspect, is / was, anchor), shift.x, shift.y, {
        w: bounds.width,
        h: bounds.height,
      }),
    );
  }

  // React listens for the wheel passively, and the page must not scroll under a zoom.
  const wheel = useEffectEvent((event: WheelEvent) => {
    event.preventDefault();
    onChange(
      zoomRect(
        rect,
        image,
        aspect,
        Math.exp(-event.deltaY * 0.002),
        anchorOf({
          x: event.clientX,
          y: event.clientY,
        }),
      ),
    );
  });
  useEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    const listener = (event: WheelEvent) => wheel(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, []);

  function release(event: React.PointerEvent) {
    pointers.current.delete(event.pointerId);
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={box}
        role="group"
        aria-label={label}
        tabIndex={0}
        style={{ aspectRatio: `${aspect.aspectW} / ${aspect.aspectH}` }}
        className="relative w-full cursor-grab touch-none select-none overflow-hidden rounded-md bg-muted focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary active:cursor-grabbing"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        }}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={(event) => {
          const next = keyRect(rect, image, aspect, event.key);
          if (next === null) return;
          event.preventDefault();
          onChange(next);
        }}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="pointer-events-none absolute max-w-none"
          style={{
            width: `${100 / rect.w}%`,
            left: `${(-rect.x / rect.w) * 100}%`,
            top: `${(-rect.y / rect.h) * 100}%`,
          }}
        />
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <span className="shrink-0">{sliderLabel}</span>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoomOf(rect, whole)}
          onChange={(event) =>
            onChange(
              zoomRect(rect, image, aspect, Number(event.target.value) / zoomOf(rect, whole), {
                u: 0.5,
                v: 0.5,
              }),
            )
          }
          className="w-full"
        />
      </label>
    </div>
  );
}

/** The hint line under a window. */
export function FrameHint() {
  return <p className="text-sm text-muted-fg">{strings.image_frames_hint}</p>;
}
