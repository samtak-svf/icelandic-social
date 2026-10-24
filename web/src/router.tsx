import { createRouter } from "@tanstack/react-router";
import { createIsomorphicFn, getGlobalStartContext } from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen.ts";

// The CSP nonce of this render (security-headers.ts). On the server it is the
// one server.ts minted for the request and put in the header; the router
// stamps it on every inline script it renders and emits it as
// <meta property="csp-nonce">, which the client reads back so the scripts it
// inserts on navigation carry it too.
//
// getGlobalStartContext() throws when Start builds a router outside a request
// (to resolve a redirect); nothing renders a document there.
const cspNonce = createIsomorphicFn()
  .server(() => {
    try {
      return getGlobalStartContext()?.cspNonce;
    } catch {
      return undefined;
    }
  })
  .client(
    () =>
      document.querySelector('meta[property="csp-nonce"]')?.getAttribute("content") ?? undefined,
  );

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    ssr: { nonce: cspNonce() },
  });
}

declare module "@tanstack/react-start" {
  interface Register {
    server: {
      // What server.ts passes to the Start handler with every request.
      requestContext: { cspNonce: string };
    };
  }
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
  interface StaticDataRouteOption {
    /**
     * "wide": the page lays out more than one column on an expanded window, so
     * the shell lets it use the width (decision 0087).
     */
    width?: "wide";
  }
}
