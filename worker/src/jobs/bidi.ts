/**
 * Mixed-direction text support for every rendered PDF. Names and free text typed by users can be Arabic /
 * Hebrew (right-to-left) inside an otherwise left-to-right document. `unicode-bidi: plaintext` makes each
 * block pick its own direction from its first strong character - the same behaviour as `dir="auto"` - so
 * a cell holding an Arabic name is laid out right-to-left without flipping the page or the English cells.
 * Injected centrally (one place) instead of editing every template's cells.
 */
export const BIDI_CSS =
  "td,th,p,li,dd,dt,h1,h2,h3,h4,span,div{unicode-bidi:plaintext;}" +
  // Numbers / reference codes must stay left-to-right and aligned inside RTL-detected blocks.
  ".doc-id,.mono,code{unicode-bidi:isolate;direction:ltr;}";

/** Adds the bidi stylesheet to a full HTML document (before </head>, or at the top when there is none). */
export function withBidi(html: string): string {
  const tag = `<style data-bidi>${BIDI_CSS}</style>`;
  const idx = html.search(/<\/head>/i);
  if (idx >= 0) return `${html.slice(0, idx)}${tag}${html.slice(idx)}`;
  return `${tag}${html}`;
}
