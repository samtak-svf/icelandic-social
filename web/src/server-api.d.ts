// What the Worker sees of the web app (backend/src/index.ts). The backend's
// type check stops here instead of reading the app, which web/'s own
// tsconfig checks; server.ts is typed by this, so the two cannot drift.
export type WebHandler = (request: Request) => Promise<Response>;

export declare const web: WebHandler;
