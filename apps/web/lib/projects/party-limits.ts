// S1-13: how many ACTIVE parties of each type one project may have. Pure, so the add-party actions and the
// tests share one rule. The caps are generous on purpose: they stop a runaway import or a typo-driven
// pile-up (twenty "client" parties on one project), not normal projects. Only NEW additions are checked, so
// a project that is already over a cap keeps working; deactivating a party frees a slot.

export const PARTY_TYPE_LIMITS = {
  jags: 10,
  client: 10,
  main_contractor: 10,
  tpi_lab: 25,
  vendor: 100,
  subcontractor: 100,
} as const;

export type LimitedPartyType = keyof typeof PARTY_TYPE_LIMITS;

const LABEL: Record<LimitedPartyType, string> = {
  jags: "JAGS",
  client: "client",
  main_contractor: "main contractor",
  tpi_lab: "TPI / lab",
  vendor: "vendor",
  subcontractor: "subcontractor",
};

export function isLimitedPartyType(value: string): value is LimitedPartyType {
  return Object.prototype.hasOwnProperty.call(PARTY_TYPE_LIMITS, value);
}

export type PartyLimitResult = { ok: true; remaining: number } | { ok: false; limit: number; message: string };

/** Whether one more active party of this type fits. `activeCount` is how many the project already has. */
export function checkPartyTypeLimit(partyType: string, activeCount: number): PartyLimitResult {
  if (!isLimitedPartyType(partyType)) return { ok: true, remaining: Number.POSITIVE_INFINITY };
  const limit = PARTY_TYPE_LIMITS[partyType];
  if (activeCount >= limit) {
    return {
      ok: false,
      limit,
      message: `This project already has ${activeCount} active ${LABEL[partyType]} part${activeCount === 1 ? "y" : "ies"} (the limit is ${limit}). Deactivate one that is no longer needed before adding another.`,
    };
  }
  return { ok: true, remaining: limit - activeCount };
}
