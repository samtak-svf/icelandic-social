import { useEffect, useRef, type ReactNode } from "react";
import { strings } from "../generated/brand/strings.ts";

// A modal dialog on the platform's own <dialog>: showModal() makes the rest
// of the page inert, keeps Tab inside it, closes on Escape and returns focus
// to what opened it, so none of that is written here (decision 0080).

export function Dialog({
  title,
  onClose,
  children,
}: Readonly<{ title: string; onClose: () => void; children: ReactNode }>) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === ref.current) onClose();
      }}
      className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-lg border border-border bg-surface p-4 text-fg backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        <button
          type="button"
          aria-label={strings.close}
          onClick={onClose}
          className="inline-flex size-11 items-center justify-center rounded-md hover:bg-muted"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="mt-3">{children}</div>
    </dialog>
  );
}
