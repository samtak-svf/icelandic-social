import type { ReactNode } from "react";
import type { SessionInfo } from "../generated/api.ts";

// The icon of a signed-in client in Settings: a browser is a globe, a phone is a phone.

function Glyph({ name, children }: Readonly<{ name: string; children: ReactNode }>) {
  return (
    <svg
      aria-hidden="true"
      data-icon={name}
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const PhoneIcon = () => (
  <Glyph name="phone">
    <rect x="7" y="2" width="10" height="20" rx="2.4" />
    <path d="M11 18h2" />
  </Glyph>
);

const GlobeIcon = () => (
  <Glyph name="globe">
    <circle cx="12" cy="12" r="9.5" />
    <path d="M2.5 12h19M12 2.5c3 3 3 16 0 19M12 2.5c-3 3-3 16 0 19" />
  </Glyph>
);

/** The icon for a session's client kind (a browser is a globe; android and ios are phones). */
export function deviceIcon(kind: SessionInfo["kind"]): ReactNode {
  return kind === "web" ? <GlobeIcon /> : <PhoneIcon />;
}
