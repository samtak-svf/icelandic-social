// The paths the API owns on the one host (decision 0062); the web app owns
// every other one. Apart from src/index.ts so the tests can read it without
// the web app. /ops is the maintainer's (decision 0068).
export const API_PATHS = /^\/(v1|auth|l|oauth|ops|\.well-known)\/|^\/health$/;
