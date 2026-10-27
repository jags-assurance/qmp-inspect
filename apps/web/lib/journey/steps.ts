/**
 * The workflow from "brand-new organisation" to "project handed over", as one ordered list.
 * Pure: the page gathers a few counts into `JourneyFacts`, this decides what is done, what is next and
 * where each step's button goes. Nothing here reads the database.
 */

export type JourneyFacts = {
  organisationId: string | null;
  projectId: string | null;
  hasNumbering: boolean;
  teamCount: number;
  projectCount: number;
  partyCount: number;
  vaultDocCount: number;
  registerCount: number;
  itpTotal: number;
  itpApproved: number;
  firstApprovedItpId: string | null;
  inspectionCount: number;
  openNcrCount: number;
  openPunchCount: number;
  irnCount: number;
  dataBookStatus: "none" | "draft" | "compiled" | "issued";
  handoverIssued: boolean;
  handoverAcknowledged: boolean;
  projectCompleted: boolean;
};

export type JourneyStepState = "done" | "next" | "todo";

export type JourneyStep = {
  key: string;
  phase: string;
  title: string;
  /** One or two plain sentences: what to do and why. */
  help: string;
  /** Label for the button. */
  action: string;
  href: string;
  optional: boolean;
  state: JourneyStepState;
  /** Short note on what the app found ("2 ITPs approved"). */
  note?: string;
  /** True when a project is needed first and none is chosen. */
  needsProject?: boolean;
};

export const JOURNEY_PHASES = [
  "Set up the organisation",
  "Set up the project",
  "Plan the work",
  "Do the work",
  "Finish and hand over",
] as const;

type Def = Omit<JourneyStep, "state" | "href" | "note" | "needsProject"> & {
  href: (f: JourneyFacts) => string;
  done: (f: JourneyFacts) => boolean;
  note?: (f: JourneyFacts) => string | undefined;
  needsProject?: boolean;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const proj = (f: JourneyFacts, path: string) => (f.projectId ? `/inspect/projects/${f.projectId}${path}` : "/inspect/projects");
const withProject = (base: string, f: JourneyFacts) => (f.projectId ? `${base}?project=${f.projectId}` : base);

const DEFS: Def[] = [
  {
    key: "org",
    phase: JOURNEY_PHASES[0],
    title: "Create the client organisation",
    help: "The company the work is for. Everything else (projects, people, numbering) hangs under it.",
    action: "Open organisations",
    optional: false,
    href: () => "/inspect/settings?section=clients",
    done: (f) => !!f.organisationId,
    note: (f) => (f.organisationId ? "Organisation selected" : undefined),
  },
  {
    key: "rules",
    phase: JOURNEY_PHASES[0],
    title: "Choose number formats and wording",
    help: "How ITP, NCR and IRN numbers look, and what you call roles. You can skip this and use the defaults.",
    action: "Open numbering",
    optional: true,
    href: () => "/inspect/settings?section=numbering",
    done: (f) => f.hasNumbering,
  },
  {
    key: "people",
    phase: JOURNEY_PHASES[0],
    title: "Give your team access and make teams",
    help: "Decide which Field Engineers can see this organisation, and group them into teams.",
    action: "Open staff access",
    optional: true,
    href: () => "/inspect/settings?section=staff-access",
    done: (f) => f.teamCount > 0,
    note: (f) => (f.teamCount ? plural(f.teamCount, "team") : undefined),
  },
  {
    key: "project",
    phase: JOURNEY_PHASES[1],
    title: "Create the project",
    help: "Give it a number, a name and its locations (blocks, areas).",
    action: "New project",
    optional: false,
    href: () => "/inspect/projects/new",
    done: (f) => f.projectCount > 0,
    note: (f) => (f.projectCount ? plural(f.projectCount, "project") : undefined),
  },
  {
    key: "parties",
    phase: JOURNEY_PHASES[1],
    title: "Add every company and give each a login",
    help: "Client, main contractor, subcontractor, TPI or lab. Each one signs off only its own steps.",
    action: "Open the project",
    optional: false,
    needsProject: true,
    href: (f) => proj(f, ""),
    done: (f) => f.partyCount > 0,
    note: (f) => (f.partyCount ? plural(f.partyCount, "company", "companies") : undefined),
  },
  {
    key: "vault",
    phase: JOURNEY_PHASES[1],
    title: "Upload the project documents",
    help: "Specifications, drawings and standards go in the Document Vault. The inspection plans refer back to them.",
    action: "Open Document Vault",
    optional: true,
    needsProject: true,
    href: (f) => withProject("/inspect/vault", f),
    done: (f) => f.vaultDocCount > 0,
    note: (f) => (f.vaultDocCount ? plural(f.vaultDocCount, "document") : undefined),
  },
  {
    key: "registers",
    phase: JOURNEY_PHASES[1],
    title: "Record instruments, welders and materials",
    help: "Calibration, welder, material and personnel certificates. The Data Book checks they are in date.",
    action: "Open registers",
    optional: true,
    needsProject: true,
    href: (f) => proj(f, "/registers"),
    done: (f) => f.registerCount > 0,
    note: (f) => (f.registerCount ? plural(f.registerCount, "entry", "entries") : undefined),
  },
  {
    key: "itp",
    phase: JOURNEY_PHASES[2],
    title: "Write the inspection plan (ITP)",
    help: "List the activities to check and who signs each one: Hold, Witness, Review or Surveillance.",
    action: "New ITP",
    optional: false,
    needsProject: true,
    href: () => "/inspect/itps/new",
    done: (f) => f.itpTotal > 0,
    note: (f) => (f.itpTotal ? plural(f.itpTotal, "ITP") : undefined),
  },
  {
    key: "approve",
    phase: JOURNEY_PHASES[2],
    title: "Submit, review and approve the ITP",
    help: "Submit it for review, then tick the review box and approve. Approving creates the checklists.",
    action: "Open ITPs",
    optional: false,
    needsProject: true,
    href: () => "/inspect/itps",
    done: (f) => f.itpApproved > 0,
    note: (f) => (f.itpApproved ? `${plural(f.itpApproved, "ITP")} approved` : undefined),
  },
  {
    key: "signoff",
    phase: JOURNEY_PHASES[2],
    title: "Tell the parties and collect their sign-offs",
    help: "Press Notify on the approved ITP. Each party signs its own point; a Hold must be signed before work goes on.",
    action: "Open approved ITP",
    optional: false,
    needsProject: true,
    href: (f) => (f.firstApprovedItpId ? `/inspect/itps/${f.firstApprovedItpId}` : "/inspect/itps"),
    done: (f) => f.inspectionCount > 0,
  },
  {
    key: "inspect",
    phase: JOURNEY_PHASES[3],
    title: "Carry out the inspections",
    help: "Field Engineers open a checklist, answer every item, attach photos, sign and complete.",
    action: "Start work",
    optional: false,
    needsProject: true,
    href: () => "/inspect/start-work",
    done: (f) => f.inspectionCount > 0,
    note: (f) => (f.inspectionCount ? plural(f.inspectionCount, "inspection") : undefined),
  },
  {
    key: "problems",
    phase: JOURNEY_PHASES[3],
    title: "Close every NCR and punch item",
    help: "A failed inspection opens a punch item by itself. Fix it, re-inspect, and close any NCRs.",
    action: "Open NCRs",
    optional: false,
    needsProject: true,
    href: () => "/inspect/ncrs",
    done: (f) => f.inspectionCount > 0 && f.openNcrCount === 0 && f.openPunchCount === 0,
    note: (f) =>
      f.openNcrCount || f.openPunchCount ? `${plural(f.openNcrCount, "open NCR")}, ${plural(f.openPunchCount, "open punch item")}` : undefined,
  },
  {
    key: "irn",
    phase: JOURNEY_PHASES[3],
    title: "Release passed inspections (IRN)",
    help: "Issue an Inspection Release Note for each inspection that passed. The Data Book needs one for every pass.",
    action: "Open inspections",
    optional: false,
    needsProject: true,
    href: () => "/inspect/inspections",
    done: (f) => f.irnCount > 0,
    note: (f) => (f.irnCount ? plural(f.irnCount, "IRN") : undefined),
  },
  {
    key: "databook",
    phase: JOURNEY_PHASES[4],
    title: "Clear the Data Book checks and create it",
    help: "The Data Book page lists what is still missing, each with a Fix link. When all are green, create the book.",
    action: "Open Data Book",
    optional: false,
    needsProject: true,
    href: (f) => proj(f, "/data-book"),
    done: (f) => f.dataBookStatus !== "none",
  },
  {
    key: "compile",
    phase: JOURNEY_PHASES[4],
    title: "Set the project to Completed and compile the book",
    help: "Mark the project Completed, then Compile. The book is locked for issue.",
    action: "Open Data Book",
    optional: false,
    needsProject: true,
    href: (f) => proj(f, "/data-book"),
    done: (f) => f.dataBookStatus === "compiled" || f.dataBookStatus === "issued",
  },
  {
    key: "handover",
    phase: JOURNEY_PHASES[4],
    title: "Issue the handover certificate",
    help: "Hand the book to the client. They acknowledge receipt, or reject it with a reason.",
    action: "Open Handover",
    optional: false,
    needsProject: true,
    href: () => "/inspect/handover",
    done: (f) => f.handoverIssued,
    note: (f) => (f.handoverAcknowledged ? "Client acknowledged" : f.handoverIssued ? "Waiting for the client" : undefined),
  },
];

/** Marks each step done / next / todo. The first required step that is not done is "next". */
export function buildJourney(f: JourneyFacts): JourneyStep[] {
  let nextTaken = false;
  return DEFS.map((d) => {
    const done = d.done(f);
    let state: JourneyStepState = "todo";
    if (done) state = "done";
    else if (!d.optional && !nextTaken) {
      state = "next";
      nextTaken = true;
    }
    const { done: _d, href, note, ...rest } = d;
    void _d;
    return { ...rest, href: href(f), note: note?.(f), state };
  });
}

export function journeyProgress(steps: JourneyStep[]): { done: number; total: number } {
  const required = steps.filter((s) => !s.optional);
  return { done: required.filter((s) => s.state === "done").length, total: required.length };
}
