// Deliberately NOT "use client" — see apps/web/app/inspect/ncrs/constants.ts for why a plain
// constant shared between a Server Component and a Client Component must live in a file with no
// "use client" directive (otherwise a Server Component importing it receives a client-reference
// proxy instead of the real value, silently breaking `.range()` offsets).
export const STANDALONE_TABLE_PAGE_SIZE = 25;
