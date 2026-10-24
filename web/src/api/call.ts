import pkg from "../../package.json" with { type: "json" };

// The one fetch behind every generated operation (web/src/generated/api.ts,
// decision 0005). It fills the path, the query and the body, names the build
// in Spjall-Client (decision 0030), sends the session cookie on the same
// origin, and hands back the status with the parsed body. A network failure
// is thrown.

/** What a caller may add to a request. */
export interface CallInit {
  /** The origin to call; empty in a browser, the web host when rendering on the server. */
  baseUrl?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

interface CallArgs {
  path?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

/** `web/<version>`, the build this client names to the API. */
export const CLIENT = `web/${pkg.version}`;

function url(template: string, args: CallArgs | undefined, baseUrl: string): string {
  const path = template.replaceAll(/\{(\w+)\}/g, (_, name: string) => {
    const value = args?.path?.[name];
    if (value === undefined) throw new TypeError(`missing path parameter ${name}`);
    return encodeURIComponent(value);
  });
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(args?.query ?? {})) {
    if (value !== undefined) query.set(name, String(value));
  }
  const search = query.size > 0 ? `?${query}` : "";
  return `${baseUrl}${path}${search}`;
}

async function data(response: Response): Promise<unknown> {
  if (response.status === 204 || response.headers.get("content-length") === "0") return undefined;
  const type = response.headers.get("content-type") ?? "";
  return type.includes("application/json") ? response.json() : response.blob();
}

/** The body as it goes on the wire: JSON, or the bytes as they are. */
function encode(body: unknown, media: string): BodyInit {
  if (media === "application/json") return JSON.stringify(body);
  if (body instanceof Blob || body instanceof ArrayBuffer) return body;
  throw new TypeError(`a ${media} body must be a Blob or an ArrayBuffer`);
}

/**
 * Typed by the generated operation that calls it, whose answers the contract
 * declares; the overload is what carries that type through.
 */
export function call<Result>(
  method: string,
  template: string,
  args: CallArgs | undefined,
  init?: CallInit,
  media?: string,
): Promise<Result>;
export async function call(
  method: string,
  template: string,
  args: CallArgs | undefined,
  init: CallInit = {},
  media = "application/json",
): Promise<{ status: number; data: unknown }> {
  const headers = new Headers(init.headers);
  headers.set("spjall-client", CLIENT);
  let body: BodyInit | undefined;
  if (args?.body !== undefined) {
    headers.set("content-type", media);
    body = encode(args.body, media);
  }
  const response = await (init.fetch ?? fetch)(url(template, args, init.baseUrl ?? ""), {
    method,
    headers,
    body,
    credentials: "same-origin",
    signal: init.signal,
  });
  return { status: response.status, data: await data(response) };
}
