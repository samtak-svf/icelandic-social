import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// A small action menu behind a button (decision 0080): the button names
// itself, Escape and a click outside close it and give focus back, and the
// items are buttons, so Tab and Enter work with no further wiring.

export function Menu({
  label,
  icon,
  align = "right",
  children,
}: Readonly<{
  label: string;
  icon: ReactNode;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-muted"
      >
        {icon}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          className={`absolute z-20 mt-1 flex min-w-48 flex-col rounded-md border border-border bg-surface py-1 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** One item of a Menu. */
export function MenuItem({
  onSelect,
  disabled = false,
  tone = "plain",
  children,
}: Readonly<{
  onSelect: () => void;
  disabled?: boolean;
  tone?: "plain" | "danger";
  children: ReactNode;
}>) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={`min-h-11 px-4 text-left hover:bg-muted disabled:opacity-60 ${tone === "danger" ? "text-danger" : ""}`}
    >
      {children}
    </button>
  );
}

/** The three dots that open a Menu. */
export function DotsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}
