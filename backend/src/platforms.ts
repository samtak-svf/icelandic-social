// The platforms a client build can report (decision 0030). Everything that
// knows about platforms is derived from this list: the request schemas, the
// floors /health shows, the Spjall-Client header and its comparison, the
// MIN_CLIENT_VERSION_<PLATFORM> var each needs (env/index.ts). The D1 CHECK on
// devices.platform is the guard of record, and test/platforms.test.ts fails
// when it and this list differ.

export const PLATFORMS = ["android", "ios"] as const;

export type Platform = (typeof PLATFORMS)[number];
