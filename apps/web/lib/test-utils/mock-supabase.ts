// Shared test helper: a chainable, recording fake of the Supabase JS client plus factories for the
// framework modules every server action imports (next/cache, next/navigation, the server client and
// the session helpers). Test files wire it up with vi.mock factories, e.g.
//
//   vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
//
// Nothing here touches a network or a database; it only answers the query shapes a test registers
// and records every call so a test can assert "the write was (not) reached".
import { vi } from "vitest";

export type Op = "select" | "insert" | "update" | "delete" | "upsert";
export type WriteOp = Exclude<Op, "select">;
export type Terminal = "single" | "maybeSingle" | "many";

export interface MockError {
  code?: string;
  message?: string;
}
export interface MockResult {
  data?: unknown;
  error?: MockError | null;
  count?: number | null;
}

export interface CallRecord {
  table: string;
  op: Op;
  payload?: unknown;
  /** [method, ...args] in call order, e.g. ["eq", "id", "x"]. */
  filters: unknown[][];
  /** Column list passed to .select(), when present. */
  columns?: string;
  terminal: Terminal;
}

export type Responder = MockResult | ((call: CallRecord) => MockResult | undefined);

const WRITE_OPS: ReadonlySet<string> = new Set(["insert", "update", "delete", "upsert"]);

function firstRow(data: unknown): unknown {
  return Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
}

export interface MockSupabase {
  client: MockClient;
  calls: CallRecord[];
  rpcCalls: { name: string; args: unknown }[];
  /** Answer queries on `table` for `op`. Later registrations win over earlier ones. */
  on(table: string, op: Op, responder: Responder): MockSupabase;
  /** Answer exactly one query, then fall back to the normal responders. */
  onOnce(table: string, op: Op, responder: Responder): MockSupabase;
  onRpc(name: string, responder: MockResult | ((args: unknown) => MockResult)): MockSupabase;
  /** Every recorded insert/update/delete/upsert, optionally narrowed. */
  writes(table?: string, op?: WriteOp): CallRecord[];
  /** The table + op of every write, in order, for compact assertions. */
  writeLog(): string[];
  setUser(user: { id: string } | null): MockSupabase;
  reset(): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MockClient = any;

export function createMockSupabase(): MockSupabase {
  const calls: CallRecord[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
  let handlers: { table: string; op: Op; responder: Responder }[] = [];
  let onceHandlers: { table: string; op: Op; responder: Responder }[] = [];
  let rpcHandlers = new Map<string, MockResult | ((args: unknown) => MockResult)>();
  let user: { id: string } | null = { id: "user-1" };

  function resolve(call: CallRecord): MockResult {
    const onceIdx = onceHandlers.findIndex((h) => h.table === call.table && h.op === call.op);
    if (onceIdx >= 0) {
      const [h] = onceHandlers.splice(onceIdx, 1);
      const r = typeof h.responder === "function" ? h.responder(call) : h.responder;
      if (r) return r;
    }
    for (let i = handlers.length - 1; i >= 0; i--) {
      const h = handlers[i];
      if (h.table !== call.table || h.op !== call.op) continue;
      const r = typeof h.responder === "function" ? h.responder(call) : h.responder;
      if (r) return r;
    }
    // Defaults: reads find nothing; writes succeed and affect one row.
    return WRITE_OPS.has(call.op) ? { data: [{ id: "mock-row" }], error: null, count: 1 } : { data: null, error: null, count: 0 };
  }

  function shape(call: CallRecord, r: MockResult) {
    const error = r.error ?? null;
    if (error) return { data: null, error, count: r.count ?? null };
    let data = r.data;
    if (data === undefined) data = call.terminal === "many" ? [] : null;
    if (call.terminal !== "many") data = firstRow(data);
    return { data, error: null, count: r.count ?? (Array.isArray(r.data) ? r.data.length : null) };
  }

  function builder(table: string) {
    const call: CallRecord = { table, op: "select", filters: [], terminal: "many" };
    let opSet = false;
    const finish = (terminal?: Terminal) => {
      if (terminal) call.terminal = terminal;
      calls.push({ ...call, filters: [...call.filters] });
      return shape(call, resolve(call));
    };
    const b: Record<string, unknown> = {};
    const chain =
      (name: string) =>
      (...args: unknown[]) => {
        if (name === "select") {
          if (!opSet) call.op = "select";
          call.columns = typeof args[0] === "string" ? args[0] : undefined;
        } else if (name === "insert" || name === "update" || name === "upsert") {
          call.op = name;
          call.payload = args[0];
          opSet = true;
        } else if (name === "delete") {
          call.op = "delete";
          opSet = true;
        } else {
          call.filters.push([name, ...args]);
        }
        return proxy;
      };
    const proxy: unknown = new Proxy(b, {
      get(_t, prop: string) {
        if (prop === "then") {
          return (resolveFn: (v: unknown) => unknown, rejectFn?: (e: unknown) => unknown) => {
            try {
              return Promise.resolve(finish()).then(resolveFn, rejectFn);
            } catch (e) {
              return Promise.reject(e).then(resolveFn, rejectFn);
            }
          };
        }
        if (prop === "single") return () => Promise.resolve(finish("single"));
        if (prop === "maybeSingle") return () => Promise.resolve(finish("maybeSingle"));
        return chain(prop);
      },
    });
    return proxy;
  }

  const storageBuckets: Record<string, unknown> = {};
  const client = {
    from: (table: string) => builder(table),
    rpc: (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      const h = rpcHandlers.get(name);
      const r = typeof h === "function" ? h(args) : (h ?? { data: null, error: null });
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null });
    },
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getClaims: async () => ({ data: user ? { claims: { sub: user.id } } : null, error: null }),
    },
    storage: {
      from: (bucket: string) =>
        (storageBuckets[bucket] ??= {
          upload: vi.fn(async () => ({ data: { path: "p" }, error: null })),
          remove: vi.fn(async () => ({ data: [], error: null })),
          download: vi.fn(async () => ({ data: null, error: { message: "not found" } })),
          createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://signed.example/x" }, error: null })),
        }),
    },
  };

  const api: MockSupabase = {
    client,
    calls,
    rpcCalls,
    on(table, op, responder) {
      handlers.push({ table, op, responder });
      return api;
    },
    onOnce(table, op, responder) {
      onceHandlers.push({ table, op, responder });
      return api;
    },
    onRpc(name, responder) {
      rpcHandlers.set(name, responder);
      return api;
    },
    writes(table, op) {
      return calls.filter((c) => WRITE_OPS.has(c.op) && (!table || c.table === table) && (!op || c.op === op));
    },
    writeLog() {
      return calls.filter((c) => WRITE_OPS.has(c.op)).map((c) => `${c.table}.${c.op}`);
    },
    setUser(u) {
      user = u;
      return api;
    },
    reset() {
      calls.length = 0;
      rpcCalls.length = 0;
      handlers = [];
      onceHandlers = [];
      rpcHandlers = new Map();
      user = { id: "user-1" };
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------
// Session + module factories

export interface TestSession {
  userId: string;
  email: string;
  fullName: string;
  isJagsStaff: boolean;
  staffRole: "admin" | "inspector" | null;
  grants: { scope_type: "global" | "organization" | "project"; organization_id: string | null; project_id: string | null; role: string }[];
}

export const sessions = {
  admin: (over: Partial<TestSession> = {}): TestSession => ({
    userId: "admin-1",
    email: "admin@jags.test",
    fullName: "Admin One",
    isJagsStaff: true,
    staffRole: "admin",
    grants: [{ scope_type: "global", organization_id: null, project_id: null, role: "Admin" }],
    ...over,
  }),
  inspector: (over: Partial<TestSession> = {}): TestSession => ({
    userId: "inspector-1",
    email: "inspector@jags.test",
    fullName: "Inspector One",
    isJagsStaff: true,
    staffRole: "inspector",
    grants: [{ scope_type: "global", organization_id: null, project_id: null, role: "Inspector" }],
    ...over,
  }),
  external: (over: Partial<TestSession> = {}): TestSession => ({
    userId: "external-1",
    email: "party@client.test",
    fullName: "External One",
    isJagsStaff: false,
    staffRole: null,
    grants: [{ scope_type: "project", organization_id: "org-1", project_id: "proj-1", role: "Client" }],
    ...over,
  }),
};

/** Mutable per-file state read by the module factories below. Reset it in beforeEach. */
export const testCtx: { mock: MockSupabase; session: TestSession | null } = {
  mock: createMockSupabase(),
  session: sessions.admin(),
};

export function resetTestCtx(session: TestSession | null = sessions.admin()): MockSupabase {
  testCtx.mock.reset();
  testCtx.session = session;
  testCtx.mock.setUser(session ? { id: session.userId } : null);
  revalidatePathSpy.mockClear();
  return testCtx.mock;
}

export class RedirectError extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

export const revalidatePathSpy = vi.fn();

export function nextNavigationModule() {
  return {
    redirect: (url: string) => {
      throw new RedirectError(url);
    },
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  };
}

export function nextCacheModule() {
  return { revalidatePath: revalidatePathSpy, revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn };
}

export function serverClientModule() {
  return {
    createSupabaseServerClient: async () => testCtx.mock.client,
  };
}

/** Same pure helpers as lib/auth/session.ts, with requireSession answering from testCtx.session. */
export function sessionModule() {
  return {
    requireSession: async () => {
      if (!testCtx.session) throw new RedirectError("/login?error=session_ended");
      return testCtx.session;
    },
    getSessionContext: async () => testCtx.session,
    isAdminStaff: (s: TestSession) => s.isJagsStaff && s.staffRole !== "inspector",
    canSeePlatformHome: (s: TestSession) => s.isJagsStaff && s.staffRole !== "inspector",
  };
}

export function formData(fields: Record<string, string | boolean | undefined | null>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === false) continue;
    fd.set(k, v === true ? "on" : v);
  }
  return fd;
}
