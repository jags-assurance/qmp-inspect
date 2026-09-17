// Deliberately NOT "use client": a plain constant like this, when exported from a "use client"
// module, does not cross the server/client boundary correctly under Next.js's RSC bundling — only
// component exports get a proper reference there. A Server Component importing a non-component
// named export from a client file was observed to receive a client-reference proxy (a function)
// instead of the real value, silently turning `(page - 1) * NCR_TABLE_PAGE_SIZE` into NaN and
// making every `.range()` call return nothing. Shared plain values used by both a Server Component
// and a Client Component must live in a file with no "use client" directive.
export const NCR_TABLE_PAGE_SIZE = 25;
