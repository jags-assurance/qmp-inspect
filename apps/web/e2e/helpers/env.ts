/**
 * Demo logins used by the e2e suite. Emails default to the seeded demo accounts and the password to
 * the shared demo password; every value can be overridden from the environment so the same suite can
 * run against another deployment (CI passes them as secrets).
 */
// `||` (not `??`): CI passes unset secrets through as empty strings, which must fall back too.
export const BASE_URL = (process.env.BASE_URL?.trim() || "https://jags-qmp-client-dev.vercel.app").replace(/\/+$/, "");
export const PASSWORD = process.env.E2E_PASSWORD || "DemoPass123!";

export type RoleKey =
  | "admin"
  | "inspector"
  | "inspectorScoped"
  | "client"
  | "subcontractor"
  | "contractor"
  | "tpi";

export interface RoleDef {
  key: RoleKey;
  label: string;
  email: string;
  /** JAGS Admin (staff_role is not 'inspector'): lands on /platform and may open admin-only pages. */
  isAdmin: boolean;
  /** Any JAGS employee (admin or inspector). */
  isStaff: boolean;
  /** Where "/" sends this role right after sign-in. */
  landingPath: "/platform" | "/inspect";
}

const envEmail = (name: string, fallback: string) => process.env[name]?.trim() || fallback;

export const ROLES: RoleDef[] = [
  { key: "admin", label: "JAGS Admin", email: envEmail("E2E_ADMIN_EMAIL", "admin@jagsassurance.local"), isAdmin: true, isStaff: true, landingPath: "/platform" },
  { key: "inspector", label: "JAGS Inspector", email: envEmail("E2E_INSPECTOR_EMAIL", "inspector@jagsassurance.local"), isAdmin: false, isStaff: true, landingPath: "/inspect" },
  { key: "inspectorScoped", label: "JAGS Inspector (project-scoped)", email: envEmail("E2E_INSPECTOR_SCOPED_EMAIL", "inspector.scoped@jagsassurance.local"), isAdmin: false, isStaff: true, landingPath: "/inspect" },
  { key: "client", label: "Client", email: envEmail("E2E_CLIENT_EMAIL", "client@meridian.demo"), isAdmin: false, isStaff: false, landingPath: "/inspect" },
  { key: "subcontractor", label: "Subcontractor", email: envEmail("E2E_SUBCONTRACTOR_EMAIL", "subcontractor@voltway.demo"), isAdmin: false, isStaff: false, landingPath: "/inspect" },
  { key: "contractor", label: "Main contractor", email: envEmail("E2E_CONTRACTOR_EMAIL", "contractor@gfl.demo"), isAdmin: false, isStaff: false, landingPath: "/inspect" },
  { key: "tpi", label: "TPI / lab", email: envEmail("E2E_TPI_EMAIL", "tpi@bureauveritas.demo"), isAdmin: false, isStaff: false, landingPath: "/inspect" },
];

export const roleByKey = (key: RoleKey): RoleDef => {
  const role = ROLES.find((r) => r.key === key);
  if (!role) throw new Error(`Unknown role ${key}`);
  return role;
};
