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
  /** Inspections that passed (each needs an IRN). */
  inspectionsPassed: number;
  /** Checklists generated from approved ITPs (one per activity that needs one). */
  checklistTotal: number;
  /** Companies added without a login yet. */
  partiesWithoutLogin: number;
  /** Sign-off cells in total, and how many are still waiting (pending or notified). */
  signoffTotal: number;
  signoffOutstanding: number;
  openNcrCount: number;
  openPunchCount: number;
  irnCount: number;
  dataBookStatus: "none" | "draft" | "compiled" | "issued";
  handoverIssued: boolean;
  handoverAcknowledged: boolean;
  projectCompleted: boolean;
  /** Sign-offs waiting for this person (or, for staff, for JAGS) right now. */
  pendingSignoffs: number;
  /** Opens the first activity waiting for this person, when there is one. */
  firstSignoffHref: string | null;
  /** ITPs still in draft. */
  itpDraft: number;
  /** ITPs approved by JAGS but not yet accepted by the client. */
  itpAwaitingClient: number;
  /** Inspections started but not completed. */
  inspectionsInProgress: number;
  /** The project allows this person's company to write ITPs. */
  canCreateItp: boolean;
};

export type JourneyRole = "admin" | "engineer" | "contractor" | "client" | "tpi";

export const ROLE_TITLE: Record<JourneyRole, string> = {
  admin: "JAGS Admin: from a new organisation to handover",
  engineer: "Field Engineer: your steps on a project",
  contractor: "Contractor: your steps on a project",
  client: "Client: your steps on a project",
  tpi: "TPI / lab: your steps on a project",
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

/** The phases in the order a role meets them (admin has all five; other roles meet fewer). */
export function journeyPhases(steps: JourneyStep[]): string[] {
  return [...new Set(steps.map((s) => s.phase))];
}

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

const inspectionsDone = (f: JourneyFacts) => (f.checklistTotal > 0 ? f.inspectionCount >= f.checklistTotal : f.inspectionCount > 0);
const inspectionNote = (f: JourneyFacts) =>
  f.inspectionCount ? (f.checklistTotal ? `${f.inspectionCount} of ${plural(f.checklistTotal, "checklist")} inspected` : plural(f.inspectionCount, "inspection")) : undefined;
const irnsDone = (f: JourneyFacts) => f.inspectionsPassed > 0 && f.irnCount >= f.inspectionsPassed;
const irnNote = (f: JourneyFacts) => (f.inspectionsPassed ? `${f.irnCount} of ${plural(f.inspectionsPassed, "passed inspection")} released` : undefined);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const proj = (f: JourneyFacts, path: string) => (f.projectId ? `/inspect/projects/${f.projectId}${path}` : "/inspect/projects");
const withProject = (base: string, f: JourneyFacts) => (f.projectId ? `${base}?project=${f.projectId}` : base);

const ADMIN_DEFS: Def[] = [
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
    done: (f) => f.partyCount > 0 && f.partiesWithoutLogin === 0,
    note: (f) =>
      f.partyCount ? `${plural(f.partyCount, "company", "companies")}${f.partiesWithoutLogin ? `, ${f.partiesWithoutLogin} without a login yet` : ""}` : undefined,
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
    done: (f) => f.signoffTotal > 0 && f.signoffOutstanding === 0,
    note: (f) => (f.signoffTotal ? `${f.signoffTotal - f.signoffOutstanding} of ${plural(f.signoffTotal, "sign-off")} done` : undefined),
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
    done: inspectionsDone,
    note: inspectionNote,
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
    done: irnsDone,
    note: irnNote,
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


const WORK = "Your work";
const WRAP = "Wrap up";

const signoffStep = (title: string, help: string): Def => ({
  key: "signoff-mine",
  phase: WORK,
  title,
  help,
  action: "Open my sign-offs",
  optional: false,
  needsProject: true,
  href: (f) => f.firstSignoffHref ?? "/inspect",
  done: (f) => f.itpApproved > 0 && f.pendingSignoffs === 0,
  note: (f) => (f.pendingSignoffs ? `${plural(f.pendingSignoffs, "point")} waiting for you` : f.itpApproved ? "Nothing waiting for you" : undefined),
});

const projectStep: Def = {
  key: "project-open",
  phase: "Get started",
  title: "Open your project",
  help: "Choose the project at the top of the page. Everything you see belongs to it.",
  action: "Open projects",
  optional: false,
  href: () => "/inspect/projects",
  done: (f) => f.projectCount > 0,
  note: (f) => (f.projectCount ? plural(f.projectCount, "project") : undefined),
};

const resultsStep: Def = {
  key: "results",
  phase: WORK,
  title: "Check inspection results",
  help: "See which inspections passed, which failed, and what was raised because of them.",
  action: "Open inspections",
  optional: true,
  href: () => "/inspect/inspections",
  done: (f) => f.inspectionCount > 0,
  note: (f) => (f.inspectionCount ? plural(f.inspectionCount, "inspection") : undefined),
};

const handoverView = (title: string, help: string, action: string): Def => ({
  key: "handover-view",
  phase: WRAP,
  title,
  help,
  action,
  optional: false,
  href: () => "/inspect/handover",
  done: (f) => f.handoverAcknowledged,
  note: (f) => (f.handoverAcknowledged ? "Acknowledged" : f.handoverIssued ? "Waiting for the client" : undefined),
});

const ROLE_DEFS: Record<Exclude<JourneyRole, "admin">, Def[]> = {
  engineer: [
    projectStep,
    {
      key: "itp-ready",
      phase: "Get started",
      title: "Check the plan is approved",
      help: "You can only inspect against an approved ITP. If it is still draft or under review, ask the Admin.",
      action: "Open ITPs",
      optional: false,
      href: () => "/inspect/itps",
      done: (f) => f.itpApproved > 0,
      note: (f) => (f.itpApproved ? `${plural(f.itpApproved, "ITP")} approved` : f.itpTotal ? `${plural(f.itpTotal, "ITP")}, none approved yet` : undefined),
    },
    signoffStep("Sign the JAGS points that are waiting", "Hold and Witness points given to JAGS show here. Open one and press Sign off."),
    {
      key: "inspect",
      phase: WORK,
      title: "Carry out the inspections",
      help: "Open a checklist, choose the location, answer every item, attach photos, sign and complete.",
      action: "Start work",
      optional: false,
      href: () => "/inspect/start-work",
      done: inspectionsDone,
      note: inspectionNote,
    },
    {
      key: "drafts",
      phase: WORK,
      title: "Finish any inspection you started",
      help: "A started inspection stays open until you complete and sign it.",
      action: "Open inspections",
      optional: false,
      href: () => "/inspect/inspections",
      done: (f) => inspectionsDone(f) && f.inspectionsInProgress === 0,
      note: (f) => (f.inspectionsInProgress ? `${plural(f.inspectionsInProgress, "inspection")} still open` : undefined),
    },
    {
      key: "problems",
      phase: WORK,
      title: "Follow up failures and NCRs",
      help: "A failed inspection opens a punch item. Re-inspect once it is fixed; raise an NCR for anything serious.",
      action: "Open NCRs",
      optional: false,
      href: () => "/inspect/ncrs",
      done: (f) => f.inspectionCount > 0 && f.openNcrCount === 0 && f.openPunchCount === 0,
      note: (f) => (f.openNcrCount || f.openPunchCount ? `${plural(f.openNcrCount, "open NCR")}, ${plural(f.openPunchCount, "open punch item")}` : undefined),
    },
    {
      key: "irn",
      phase: WRAP,
      title: "Release passed inspections (IRN)",
      help: "Issue a release note for each inspection that passed, if your role allows it.",
      action: "Open inspections",
      optional: true,
      href: () => "/inspect/inspections",
      done: irnsDone,
      note: irnNote,
    },
  ],
  contractor: [
    projectStep,
    {
      key: "vault",
      phase: "Get started",
      title: "Upload your documents",
      help: "Method statements, certificates and drawings go in the Document Vault so the plan can refer to them.",
      action: "Open Document Vault",
      optional: true,
      href: (f) => withProject("/inspect/vault", f),
      done: (f) => f.vaultDocCount > 0,
      note: (f) => (f.vaultDocCount ? plural(f.vaultDocCount, "document") : undefined),
    },
    {
      key: "itp",
      phase: "Plan the work",
      title: "Write the inspection plan (ITP) and send it for review",
      help: "If the project lets your company write ITPs: list the activities and who signs each, then Submit for review. Otherwise JAGS writes it.",
      action: "Open ITPs",
      optional: true,
      href: (f) => (f.canCreateItp ? "/inspect/itps/new" : "/inspect/itps"),
      done: (f) => f.itpTotal > 0 && f.itpDraft === 0,
      note: (f) => (f.itpDraft ? `${plural(f.itpDraft, "ITP")} still draft` : f.itpTotal ? plural(f.itpTotal, "ITP") : undefined),
    },
    signoffStep("Sign the points that are waiting for you", "Open the ITP, check the work, and press Sign off. A Hold must be signed before work goes on."),
    resultsStep,
    {
      key: "ncr",
      phase: WORK,
      title: "Respond to NCRs and punch items",
      help: "Fix what was raised, add evidence, and ask for it to be closed.",
      action: "Open NCRs",
      optional: false,
      href: () => "/inspect/ncrs",
      done: (f) => f.inspectionCount > 0 && f.openNcrCount === 0 && f.openPunchCount === 0,
      note: (f) => (f.openNcrCount || f.openPunchCount ? `${plural(f.openNcrCount, "open NCR")}, ${plural(f.openPunchCount, "open punch item")}` : undefined),
    },
    handoverView("See the handover package", "When JAGS issues the Data Book you can read it here. The client acknowledges it.", "Open Handover"),
  ],
  tpi: [
    projectStep,
    {
      key: "certs",
      phase: "Get started",
      title: "Attach your certificates and reports",
      help: "Test reports and certificates go in the Document Vault, then on the activity they belong to.",
      action: "Open Document Vault",
      optional: true,
      href: (f) => withProject("/inspect/vault", f),
      done: (f) => f.vaultDocCount > 0,
      note: (f) => (f.vaultDocCount ? plural(f.vaultDocCount, "document") : undefined),
    },
    signoffStep("Sign the points that are waiting for you", "A Hold stops work until you sign, so do those first. Open the ITP and press Sign off."),
    resultsStep,
  ],
  client: [
    projectStep,
    {
      key: "accept",
      phase: "Plan the work",
      title: "Accept the approved plan (ITP)",
      help: "After JAGS approves an ITP, read the checklist that goes with it, tick the box and press Accept ITP.",
      action: "Open ITPs",
      optional: false,
      href: () => "/inspect/itps",
      done: (f) => f.itpApproved > 0 && f.itpAwaitingClient === 0,
      note: (f) => (f.itpAwaitingClient ? `${plural(f.itpAwaitingClient, "ITP")} waiting for your acceptance` : undefined),
    },
    signoffStep("Sign the points that are waiting for you", "You may be asked to witness a test or approve a Hold. Open the ITP and press Sign off."),
    resultsStep,
    {
      key: "ncr",
      phase: WORK,
      title: "Follow open NCRs",
      help: "See what was raised and whether it has been closed. Some need your acceptance.",
      action: "Open NCRs",
      optional: true,
      href: () => "/inspect/ncrs",
      done: (f) => f.inspectionCount > 0 && f.openNcrCount === 0,
      note: (f) => (f.openNcrCount ? plural(f.openNcrCount, "open NCR") : undefined),
    },
    handoverView("Receive the handover", "When the Data Book is issued, open the certificate and Acknowledge receipt, or Reject with a reason.", "Open Handover"),
  ],
};

/** Marks each step done / next / todo. The first required step that is not done is "next". */
export function buildJourney(f: JourneyFacts, role: JourneyRole = "admin"): JourneyStep[] {
  let nextTaken = false;
  const defs = role === "admin" ? ADMIN_DEFS : ROLE_DEFS[role];
  return defs.map((d) => {
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
