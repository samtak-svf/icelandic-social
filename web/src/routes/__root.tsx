import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import appleTouchIcon from "../generated/brand/apple-touch-icon.png?url";
import favicon from "../generated/brand/favicon.svg?url";
import { strings } from "../generated/brand/strings.ts";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "light dark" },
      { title: strings.app_name },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: favicon, type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: appleTouchIcon },
    ],
  }),
  component: Root,
});

function Root() {
  return (
    <Document>
      <Outlet />
    </Document>
  );
}

function Document({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="is">
      <head>
        <HeadContent />
      </head>
      <body className="bg-surface font-sans text-fg antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
