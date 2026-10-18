// Profiles: what one account sees of another, its name, photo and place in
// the directory, and the routes to block one (decisions 0022, 0024, 0034,
// 0036, 0039). It owns no table: it reads identity's and messaging's.

export { accountRoutes } from "./people.ts";
export { deleteAccountPhoto, photoRoutes } from "./photos.ts";
export { likeLiteral, nameKey } from "./profiles.ts";
