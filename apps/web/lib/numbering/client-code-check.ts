// Pure rules behind "Check client code": given the code being typed, the other numbering configs it
// could collide with and this organisation's project numbers, say whether it is safe and what to use.
// No database access here so it unit-tests directly; the server action feeds it rows.

export interface ClientCodeCheckInput {
  code: string;
  /** Client codes already used by OTHER organisations' numbering configs (any doc type). */
  otherOrgCodes: string[];
  /** This organisation's own configured client codes, per other doc type (code differs by type is fine, but flagged). */
  ownOtherTypeCodes: { docType: string; code: string }[];
  /** Project numbers of this organisation's projects. */
  projectNumbers: string[];
}

export interface ClientCodeCheckResult {
  status: "ok" | "warning" | "conflict";
  message: string;
  suggestions: string[];
}

const norm = (v: string) => v.trim().toUpperCase();

export function checkClientCode(input: ClientCodeCheckInput): ClientCodeCheckResult {
  const code = norm(input.code);
  if (!code) return { status: "conflict", message: "Enter a client code first.", suggestions: [] };

  const projectNumbers = input.projectNumbers.map(norm);
  const usedElsewhere = new Set(input.otherOrgCodes.map(norm));
  const suggestions = [...new Set(projectNumbers)].filter((n) => !usedElsewhere.has(n) && n !== code).slice(0, 5);

  if (usedElsewhere.has(code)) {
    return {
      status: "conflict",
      message: `"${code}" is already the client code of another organisation, so document numbers could collide. Choose a different code.`,
      suggestions,
    };
  }
  const differing = input.ownOtherTypeCodes.filter((c) => norm(c.code) !== code);
  if (projectNumbers.length > 0 && !projectNumbers.includes(code)) {
    return {
      status: "warning",
      message: `"${code}" is free, but it does not match any of this organisation's project numbers. Numbers will still be unique; it just will not tell readers which project a document belongs to.`,
      suggestions,
    };
  }
  if (differing.length > 0) {
    const list = differing.map((c) => `${c.docType} uses ${norm(c.code)}`).join(", ");
    return {
      status: "warning",
      message: `"${code}" is free, but other document types in this organisation use a different client code (${list}). Mixed codes make related documents harder to trace.`,
      suggestions: [],
    };
  }
  return { status: "ok", message: `"${code}" is not used by any other organisation and matches this organisation's projects.`, suggestions: [] };
}
