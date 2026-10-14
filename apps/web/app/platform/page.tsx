import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth/session";
import { T } from "@/components/domain/t";

const MODULES = [
  { key: "inspect", name: "QMP Inspect", active: true, href: "/inspect" },
  { key: "resource", name: "QMP Resource", active: false },
  { key: "audit", name: "QMP Audit", active: false },
  { key: "comply", name: "QMP Comply", active: false },
  { key: "improve", name: "QMP Improve", active: false },
  { key: "iso", name: "QMP ISO", active: false },
  { key: "prequal", name: "QMP PreQual", active: false },
  { key: "train", name: "QMP Train", active: false },
  { key: "surveillance", name: "QMP Surveillance", active: false },
];

// Ring layout for the module "orbit": the active module sits at 12 o'clock, the rest fan out
// clockwise around the JA emblem, matching the client's reference mockup. Sized as large as
// possible while still fitting one screen with no scrolling on a typical laptop viewport (~700px
// of content height after the app header) — verified at both 1366x768 and a tighter 1280x700.
const RING_RADIUS = 168;
const RING_SIZE = "h-[410px]";

export default async function PlatformHomePage() {
  const session = await requireSession();
  const firstName = session.fullName.split(" ")[0];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink"><T>Welcome back,</T> {firstName}</h1>
      <p className="mt-1 text-sm text-muted">
        <T>Your modules. Greyed ones are not enabled for your organisation.</T>
      </p>

      {/* Phone: the orbit diagram is laid out in fixed pixels and cannot fit a 390px screen, so the same
          modules show as a card list instead (tablet and up keep the orbit). */}
      <ul className="mt-4 grid gap-3 md:hidden">
        {MODULES.map((mod) => (
          <li key={mod.key} className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{mod.name}</p>
              <div className="mt-1">{mod.active ? <Badge tone="gold"><T>Active</T></Badge> : <Badge tone="neutral"><T>Not enabled</T></Badge>}</div>
            </div>
            {mod.active && mod.href && (
              <Link href={mod.href} className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-burgundy hover:underline">
                <T>Open →</T>
              </Link>
            )}
          </li>
        ))}
      </ul>

      <div className={`relative mx-auto mt-4 hidden md:flex ${RING_SIZE} w-full max-w-2xl items-center justify-center`}>
        {/* Guide ring */}
        <div
          className="pointer-events-none absolute rounded-full border border-border"
          style={{ width: RING_RADIUS * 2, height: RING_RADIUS * 2 }}
        />

        {/* Centre JA emblem */}
        <div className="flex h-[86px] w-[86px] items-center justify-center rounded-full border-4 border-gold bg-surface text-xl font-bold text-burgundy shadow-sm">
          <T>JA</T>
        </div>

        {MODULES.map((mod, i) => {
          const angle = (i / MODULES.length) * 2 * Math.PI - Math.PI / 2;
          const x = RING_RADIUS * Math.cos(angle);
          const y = RING_RADIUS * Math.sin(angle);
          const bubble = (
            <div
              className={
                "flex h-12 w-12 items-center justify-center rounded-full border-2 text-center shadow-sm " +
                (mod.active
                  ? "border-gold bg-burgundy text-white"
                  : "border-border bg-surface text-muted")
              }
            >
              {mod.active ? (
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-6 w-6">
                  <rect x="4" y="3" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M7 7.5h6M7 10.5h6M7 13.5h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : (
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
                  <rect x="5" y="9" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M7 9V6.5a3 3 0 0 1 6 0V9" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              )}
            </div>
          );

          return (
            <div
              key={mod.key}
              className="absolute flex flex-col items-center gap-1.5"
              style={{ transform: `translate(${x}px, ${y}px)` }}
            >
              {mod.active && mod.href ? (
                <Link href={mod.href} aria-label={`Open ${mod.name}`}>
                  {bubble}
                </Link>
              ) : (
                bubble
              )}
              <div className="w-24 text-center leading-tight">
                <div className="text-xs font-medium text-ink">{mod.name}</div>
                {mod.active ? (
                  <Badge tone="gold"><T>Active</T></Badge>
                ) : (
                  <Badge tone="neutral"><T>Not enabled</T></Badge>
                )}
              </div>
              {mod.active && mod.href && (
                <Link
                  href={mod.href}
                  className="text-xs font-medium text-burgundy hover:underline"
                >
                  <T>Open module →</T>
                </Link>
              )}
            </div>
          );
        })}
      </div>

      <div className="mx-auto mt-2 hidden max-w-2xl items-center justify-center gap-6 text-xs text-muted md:flex">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border-2 border-gold bg-burgundy" /> <T>Active module</T>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border-2 border-border bg-surface" /> <T>Not enabled</T>
        </span>
      </div>
    </div>
  );
}
