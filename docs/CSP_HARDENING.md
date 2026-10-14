# CSP hardening plan

Status: the enforced CSP (apps/web/lib/security/headers.ts) is unchanged. This document explains why and how to tighten it.

## Why 'unsafe-inline' remains
- `script-src 'self' 'unsafe-inline'`: Next.js emits inline `<script>` tags for the RSC flight payload (`self.__next_f.push(...)`), bootstrap and hydration data. Without a nonce or hash these are blocked and the page does not hydrate. Hashes are not practical because the payload differs on every request.
- `style-src 'self' 'unsafe-inline'`: Next, Tailwind output and several component libraries inject `<style>` and `style=""` attributes at runtime. Style attributes cannot be nonced at all (only `style-src-attr 'unsafe-inline'` allows them), so style tightening is lower value and should come last.
- `'unsafe-eval'` is only needed by the dev server (React refresh). Production already ships a Report-Only variant without it (`buildCsp(..., { allowEval: false })`).
- Already strict: `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, scoped `connect-src`/`img-src`. The residual risk of `unsafe-inline` is that an HTML-injection bug could run script; React escaping and the absence of `dangerouslySetInnerHTML` on user content are the current mitigation.

## Target: nonce + strict-dynamic
`script-src 'self' 'nonce-<random>' 'strict-dynamic'` (keep `'unsafe-inline'` as an ignored fallback for old browsers; CSP3 browsers ignore it when a nonce/strict-dynamic is present). Next 16 reads the nonce from the request's `Content-Security-Policy` header and applies it to its own scripts automatically during server rendering.

## Steps
1. Read `node_modules/next/dist/docs/01-app/` (Content Security Policy guide) first; Next 16 renames middleware to `proxy.ts`, and this repo already has `apps/web/proxy.ts`.
2. In `proxy.ts`, per request: `nonce = btoa(crypto.randomUUID())`; build the policy with a new `buildCsp(supabaseUrl, { nonce })` option producing `script-src 'self' 'nonce-X' 'strict-dynamic'`; set it on the forwarded request headers (`Content-Security-Policy` and `x-nonce`) AND on the response.
3. Remove the static CSP header from `next.config.ts` `headers()` for HTML routes (keep other security headers there) so there is one policy source.
4. Rendering consequence: nonces require dynamic rendering. Any statically prerendered or ISR page loses static caching; audit with `next build` output (the circle/lambda markers). Most authenticated pages here are already dynamic (cookies), so the impact should be limited to the login/marketing pages.
5. Third-party scripts (Sentry loader, analytics) must be loaded via nonce-bearing `<Script nonce={nonce}>` or bundled; with `strict-dynamic` host allowlists are ignored.
6. Ship in Report-Only first: send the nonce policy as `Content-Security-Policy-Report-Only` next to the enforced one for at least one release, collect violations (Sentry `report-uri`/`report-to`), fix, then flip. `CSP_REPORT_ONLY=1` remains the emergency rollback switch.
7. Add an e2e test that loads sign-in and one authenticated page and asserts no CSP violation console errors; add a unit test that `buildCsp` with a nonce contains `'nonce-` and `'strict-dynamic'` and no `'unsafe-inline'` in script-src.
8. Later, optional: `style-src` nonce for `<style>` elements and `style-src-attr 'unsafe-inline'` split; drop the Google Fonts host by self-hosting fonts via `next/font`.

## Risks
- Missed nonce on any inline script silently breaks hydration in that page (white/unresponsive page). Mitigated by Report-Only soak and e2e.
- Losing static rendering raises server cost/latency for public pages.
- `strict-dynamic` ignores host allowlists: scripts injected by trusted scripts run, so a compromised first-party bundle is still trusted.
- Browser extensions that inject inline scripts will log violations (noise in reports).
- Edge vs node runtime: nonce generation must use Web Crypto (available in the proxy runtime).
