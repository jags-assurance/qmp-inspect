// Plain module: the list page is a server component, and a constant imported from the "use client"
// table reaches it as undefined, which made the page offset NaN and the list render no rows at all.
export const INSPECTIONS_PAGE_SIZE = 50;
