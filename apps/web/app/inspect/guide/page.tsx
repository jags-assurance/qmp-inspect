import type { Metadata } from "next";
import Link from "next/link";
import { requireSession, isAdminStaff } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Guide" };

type Category = "Plan" | "Execute" | "Quality" | "Records";

const CATEGORY_ACCENT: Record<Category, string> = {
  Plan: "border-l-info",
  Execute: "border-l-burgundy",
  Quality: "border-l-warning",
  Records: "border-l-success",
};

const MODULES: { category: Category; title: string; body: string; href: string }[] = [
  {
    category: "Plan",
    title: "ITPs",
    body: "The Inspection & Test Plan — the master document for a piece of work: what activities need checking, to what acceptance criteria, who signs off each one (H/W/R/S), and in what order. Everything else hangs off an ITP's activities.",
    href: "/inspect/itps",
  },
  {
    category: "Plan",
    title: "Master ITP Library",
    body: "JAGS's own internal library of reusable ITP templates — never visible to a client. Copy a proven template straight onto a new project instead of building from scratch.",
    href: "/inspect/itp-master",
  },
  {
    category: "Execute",
    title: "Checklists & Inspections",
    body: "Once an ITP is Approved, each Checklist-type activity gets a real field checklist. Start inspection → answer every item → Complete — a single \"No\" fails the whole inspection.",
    href: "/inspect/itps",
  },
  {
    category: "Execute",
    title: "IRNs (Inspection Release Notices)",
    body: "A formal release stamp issued once an inspection passes — the paper trail that says \"this specific piece of work is cleared to proceed.\"",
    href: "/inspect/itps",
  },
  {
    category: "Execute",
    title: "Standalone / FAT Assignments",
    body: "A one-off test or inspection not tied to a full ITP — e.g. a Factory Acceptance Test on equipment before it reaches site. Unlike ITP checklists, only JAGS staff can create, run or finalize one — a contractor/client login can view it but never self-execute it.",
    href: "/inspect/standalone",
  },
  {
    category: "Quality",
    title: "NCRs (Non-Conformance Reports)",
    body: "Raised when something doesn't meet spec — from a failed inspection, a walkdown, or standalone. Needs root cause, corrective action and verification notes before it can close.",
    href: "/inspect/ncrs",
  },
  {
    category: "Quality",
    title: "Observations",
    body: "Not a separate module — it's the exact same NCR engine, just raised with severity set to \"Observation\" instead of Minor/Major at the time you raise it. Closing one still needs root cause, corrective action and verification notes, same as any NCR.",
    href: "/inspect/observations",
  },
  {
    category: "Quality",
    title: "Punch List",
    body: "Every outstanding item, from any source — failed inspection, NCR, conditional-pass FAT, walkdown, or manual entry. The single place that answers \"what's still not resolved.\"",
    href: "/inspect/projects",
  },
  {
    category: "Records",
    title: "Document Vault",
    body: "The project's controlled document store — specs, standards, drawings, method statements, certificates — in 11 fixed folders. A same-revision upload supersedes the old one; nothing is silently lost.",
    href: "/inspect/vault",
  },
  {
    category: "Records",
    title: "Data Book",
    body: "A weighted readiness % across every real gating category — ITPs approved, inspections with an issued IRN, completed checklists, calibration/welder/material registers in date, and NCRs closed. It won't compile while any punch list item is still open, unless a JAGS staff member explicitly overrides it with a documented reason — a deliberate, logged exception, never a silent bypass. Compiling it produces the handover package.",
    href: "/inspect/projects",
  },
  {
    category: "Records",
    title: "Handover",
    body: "Where a compiled Data Book lands for the client to see and formally acknowledge receipt of.",
    href: "/inspect/handover",
  },
];

const ROLE_CONTENT: Record<
  string,
  { heading: string; tagline: string; points: string[]; quickLinks: { label: string; href: string }[] }
> = {
  jags_admin: {
    heading: "JAGS Admin",
    tagline: "You run the operation — commercially and technically.",
    points: [
      "Create projects, manage staff access, configure numbering/branding, approve Master ITP Library proposals.",
      "Everything an Inspector can do, plus the admin-only screens under Client Organisations, Numbering, Staff Access.",
      "Can sign off ANY party's cell on the intervention grid — staff can always countersign on a party's behalf.",
    ],
    quickLinks: [
      { label: "Projects", href: "/inspect/projects" },
      { label: "Staff Access", href: "/inspect/organisation/staff-access" },
      { label: "Master ITP Library", href: "/inspect/itp-master" },
    ],
  },
  jags_inspector: {
    heading: "JAGS Inspector",
    tagline: "You're the field officer running the actual QA/QC process.",
    points: [
      "Build/edit ITPs, generate and run checklists, raise NCRs, issue IRNs.",
      "No billing/staff-access/numbering settings — those are Admin-only.",
      "Like an Admin, you can sign off any party's cell on the intervention grid on their behalf.",
    ],
    quickLinks: [
      { label: "Start work", href: "/inspect/start-work" },
      { label: "ITPs", href: "/inspect/itps" },
      { label: "NCRs", href: "/inspect/ncrs" },
    ],
  },
  client: {
    heading: "Client",
    tagline: "You review and accept the work — you don't run inspections yourself.",
    points: [
      "You review and accept work JAGS/the contractor has done.",
      "On the intervention grid, you can only sign off YOUR OWN party's cells — never the contractor's or JAGS's.",
      "You accept a finished ITP (Client Accepted status) and acknowledge Handover packages.",
    ],
    quickLinks: [
      { label: "Dashboard", href: "/inspect" },
      { label: "ITPs", href: "/inspect/itps" },
      { label: "Handover", href: "/inspect/handover" },
    ],
  },
  subcontractor: {
    heading: "Subcontractor",
    tagline: "You deliver a specific scope of physical work.",
    points: [
      "You can always physically execute (self-inspect) an ITP checklist for your own work — this isn't a special permission JAGS has to switch on. (Standalone/FAT assignments are the one exception: those stay JAGS-staff-only to execute.)",
      "Can only sign off YOUR OWN party's cells on the intervention grid.",
      "Notified whenever a Witness/Hold point is set against your party on an activity.",
    ],
    quickLinks: [
      { label: "Dashboard", href: "/inspect" },
      { label: "ITPs", href: "/inspect/itps" },
    ],
  },
  main_contractor: {
    heading: "Main Contractor",
    tagline: "You typically hold broad oversight across the project.",
    points: [
      "Same sign-off rules as a subcontractor — your own party's cells only.",
      "Typically holds Witness-level oversight across most activities, and — like a subcontractor — can always self-execute ITP checklists for its own work by default (Standalone/FAT assignments remain JAGS-staff-only).",
    ],
    quickLinks: [
      { label: "Dashboard", href: "/inspect" },
      { label: "ITPs", href: "/inspect/itps" },
    ],
  },
  tpi_lab: {
    heading: "TPI / Independent Lab",
    tagline: "You verify independently — you never execute the work yourself.",
    points: [
      "An independent verifier — you review/witness, but never physically execute the checklist.",
      "Can only sign off your own party's cells on the grid.",
    ],
    quickLinks: [
      { label: "Dashboard", href: "/inspect" },
      { label: "ITPs", href: "/inspect/itps" },
    ],
  },
};

function DiagramShell({ label, children, caption }: { label: string; children: React.ReactNode; caption: string }) {
  return (
    <figure className="mt-4 rounded-lg border border-border bg-off-white p-4">
      <svg viewBox="0 0 900 220" role="img" aria-label={label} className="w-full text-ink">
        <defs>
          <marker id={`arrow-${label.slice(0, 8).replace(/\s/g, "")}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>
        {children}
      </svg>
      <figcaption className="mt-2 text-xs text-muted">{caption}</figcaption>
    </figure>
  );
}

function Box({ x, y, w = 130, h = 60, label }: { x: number; y: number; w?: number; h?: number; label: string }) {
  const lines = label.split("\n");
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill="none" stroke="currentColor" />
      {lines.map((line, li) => (
        <text key={li} x={x + w / 2} y={y + h / 2 - ((lines.length - 1) * 8) + li * 16 + 4} textAnchor="middle" fontSize="12">
          {line}
        </text>
      ))}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, markerId }: { x1: number; y1: number; x2: number; y2: number; markerId: string }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" markerEnd={`url(#${markerId})`} />;
}

function CoreWorkflowDiagram() {
  const m = "arrow-Thecorewor";
  return (
    <DiagramShell
      label="Core workflow: ITP leads to Checklist, then Inspection, then IRN on pass, or NCR and Punch List on fail; everything feeds the Data Book, which feeds Handover."
      caption="Every ITP activity flows through this pipeline. A fail never stops the project — it spins off an NCR and a punch item to track the rework, and the item can be re-inspected independently. Data Book readiness (and therefore Handover) only reaches 100% once every ITP, IRN, NCR and punch item is genuinely resolved."
    >
      <Box x={10} y={70} label={"ITP\n(Approved)"} />
      <Box x={170} y={70} label={"Checklist\ngenerated"} />
      <Box x={330} y={70} label={"Inspection\nrun"} />
      <Arrow x1={140} y1={100} x2={168} y2={100} markerId={m} />
      <Arrow x1={300} y1={100} x2={328} y2={100} markerId={m} />
      <Arrow x1={460} y1={90} x2={520} y2={40} markerId={m} />
      <text x={470} y={30} fontSize="11">Pass</text>
      <Box x={520} y={10} w={130} h={50} label="IRN issued" />
      <Arrow x1={460} y1={110} x2={520} y2={160} markerId={m} />
      <text x={465} y={150} fontSize="11">Fail</text>
      <Box x={520} y={140} w={130} h={50} label="NCR + Punch item" />
      <Arrow x1={650} y1={35} x2={730} y2={35} markerId={m} />
      <Arrow x1={650} y1={165} x2={730} y2={100} markerId={m} />
      <Box x={730} y={75} w={130} h={50} label="Data Book" />
      <Arrow x1={795} y1={125} x2={795} y2={190} markerId={m} />
      <text x={800} y={210} fontSize="12">Handover</text>
    </DiagramShell>
  );
}

function NcrLifecycleDiagram() {
  const m = "arrow-NCRlifecyc";
  return (
    <DiagramShell
      label="NCR lifecycle: Raised, spins off a punch item, root cause, corrective action and verification notes recorded (preventive action optional), then closed, which also closes the linked punch item."
      caption="Raising an NCR always creates a matching punch list item too, so it's tracked project-wide even before the NCR paperwork is finished. Closing requires root cause, corrective action AND verification notes — all three, not just a status flip. Preventive action is a separate field but is NOT required to close."
    >
      <Box x={10} y={80} label={"NCR\nraised"} />
      <Arrow x1={140} y1={110} x2={198} y2={110} markerId={m} />
      <Box x={200} y={80} label={"Punch item\ncreated"} />
      <Arrow x1={140} y1={100} x2={198} y2={40} markerId={m} />
      <text x={145} y={65} fontSize="11">also</text>
      <Arrow x1={330} y1={110} x2={388} y2={110} markerId={m} />
      <Box x={390} y={80} w={190} label={"Root cause + corrective\naction + verification notes"} />
      <Arrow x1={580} y1={110} x2={638} y2={110} markerId={m} />
      <Box x={640} y={80} label={"NCR\nclosed"} />
      <Arrow x1={705} y1={140} x2={265} y2={140} markerId={m} />
      <text x={420} y={160} fontSize="11">closes the matching punch item too</text>
    </DiagramShell>
  );
}

function PunchListLifecycleDiagram() {
  const m = "arrow-Punchlistl";
  const sources = ["Inspection fail", "NCR", "FAT conditional pass", "Walkdown", "Manual"];
  return (
    <DiagramShell
      label="Punch list lifecycle: five possible sources all create an open punch item, which stays open until someone closes it with evidence, at which point it stops counting against Data Book readiness."
      caption="Five different events can create a punch item — they all land in the same register. An item stays open (and keeps Data Book readiness below 100%) until someone explicitly closes it with a written closing-evidence note — nothing closes it automatically, even if the underlying issue gets fixed."
    >
      {sources.map((s, i) => (
        <g key={s}>
          <Box x={10} y={10 + i * 40} w={170} h={30} label={s} />
          <Arrow x1={180} y1={25 + i * 40} x2={238} y2={100} markerId={m} />
        </g>
      ))}
      <Box x={240} y={80} w={160} label={"Punch item\n(open)"} />
      <Arrow x1={400} y1={105} x2={458} y2={105} markerId={m} />
      <Box x={460} y={80} w={190} label={"Closed\n(with evidence note)"} />
      <Arrow x1={650} y1={105} x2={730} y2={105} markerId={m} />
      <Box x={730} y={80} w={140} label={"Data Book\nreadiness"} />
    </DiagramShell>
  );
}

export default async function AppGuidePage() {
  const session = await requireSession();

  const roleKey = session.isJagsStaff
    ? isAdminStaff(session)
      ? "jags_admin"
      : "jags_inspector"
    : session.grants[0]?.role ?? null;
  const roleContent = roleKey ? ROLE_CONTENT[roleKey] : null;

  const categories: Category[] = ["Plan", "Execute", "Quality", "Records"];

  return (
    <div className="max-w-4xl">
      <div className="rounded-xl border border-border bg-gradient-to-br from-burgundy/5 to-transparent p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-burgundy">QMP Inspect — App Guide</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">How this application works</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          One place for what every module does, how the pieces connect end to end, and exactly what your own role is
          responsible for.
        </p>

        {roleContent && (
          <div className="mt-5 rounded-lg border border-burgundy/30 bg-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-ink">Your role: {roleContent.heading}</h2>
              <div className="flex gap-2">
                {roleContent.quickLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="rounded-md border border-border bg-off-white px-2.5 py-1 text-xs font-medium text-ink hover:bg-burgundy/10"
                  >
                    {l.label} →
                  </Link>
                ))}
              </div>
            </div>
            <p className="mt-1 text-sm text-muted">{roleContent.tagline}</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink">
              {roleContent.points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Every role, at a glance</h2>
        <p className="mt-1 text-sm text-muted">
          Not just your own role — what everyone else on a project is responsible for too, so you know who to expect
          to see doing what.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {Object.entries(ROLE_CONTENT).map(([key, role]) => (
            <div
              key={key}
              className={`rounded-lg border p-4 ${roleKey === key ? "border-burgundy/40 bg-burgundy/5" : "border-border bg-surface"}`}
            >
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-ink">{role.heading}</h3>
                {roleKey === key && <span className="rounded-full bg-burgundy px-1.5 py-0.5 text-[10px] font-medium text-white">You</span>}
              </div>
              <p className="mt-1 text-xs text-muted">{role.tagline}</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink">
                {role.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">The core workflow</h2>
        <CoreWorkflowDiagram />
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Every module, by stage</h2>
        {categories.map((category) => (
          <div key={category} className="mt-4">
            <p className="text-sm font-semibold text-ink">{category}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {MODULES.filter((m) => m.category === category).map((m) => (
                <Link
                  key={m.title}
                  href={m.href}
                  className={`rounded-lg border border-border border-l-4 bg-surface p-4 transition-colors hover:bg-off-white ${CATEGORY_ACCENT[m.category]}`}
                >
                  <h3 className="text-sm font-semibold text-ink">{m.title}</h3>
                  <p className="mt-1 text-sm text-muted">{m.body}</p>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">How an NCR moves through the system</h2>
        <NcrLifecycleDiagram />
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">How the punch list actually works</h2>
        <PunchListLifecycleDiagram />
      </section>

      <section className="mt-8 rounded-lg border border-border bg-off-white p-4">
        <h2 className="text-sm font-semibold text-ink">The H / W / R / S sign-off levels</h2>
        <p className="mt-1 text-xs text-muted">
          These four are the defaults every organisation starts with — they're not hardcoded. An Admin can add a
          custom level for their own org (e.g. "CQR — Client QA Review"), and it appears on the grid automatically
          with its own colour, blocking or non-blocking exactly like a built-in one. If you see a level below that
          isn't one of these four, that's why.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-danger/40 bg-danger/5 p-3">
            <p className="text-sm font-semibold text-danger">H — Hold (blocking)</p>
            <p className="mt-1 text-sm text-muted">
              Work physically cannot proceed past this point until that party signs off. No automatic fallback.
            </p>
          </div>
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
            <p className="text-sm font-semibold text-warning">W — Witness</p>
            <p className="mt-1 text-sm text-muted">
              That party should be there to watch, but if they don't respond within the notice period, work can proceed
              anyway ("Proceed" unlocks after the wait).
            </p>
          </div>
          <div className="rounded-md border border-info/40 bg-info/5 p-3">
            <p className="text-sm font-semibold text-info">R — Review</p>
            <p className="mt-1 text-sm text-muted">Paperwork review after the fact — no physical presence needed.</p>
          </div>
          <div className="rounded-md border border-border bg-surface p-3">
            <p className="text-sm font-semibold text-ink">S — Surveillance</p>
            <p className="mt-1 text-sm text-muted">Light, occasional spot-checking.</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted">
          A non-staff login can only ever sign off its OWN party's cell — JAGS staff can sign off any party's cell on their
          behalf.
        </p>
      </section>

      <section className="mt-8 rounded-lg border border-border bg-off-white p-4">
        <h2 className="text-sm font-semibold text-ink">Looking for a specific project?</h2>
        <p className="mt-1 text-sm text-muted">
          Open any project and go to its own <strong>Project Guide</strong> for that project's real requirements, who's
          actually on it, and what you specifically are responsible for there.
        </p>
      </section>
    </div>
  );
}
