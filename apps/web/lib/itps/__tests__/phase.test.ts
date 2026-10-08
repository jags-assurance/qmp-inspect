import { describe, expect, it } from "vitest";
import { ITP_PHASES, ITP_PHASE_LABEL, ITP_PHASE_TONE, normalizeItpPhase } from "../phase";

describe("normalizeItpPhase", () => {
  it("passes the three real phases through", () => {
    for (const phase of ITP_PHASES) expect(normalizeItpPhase(phase)).toBe(phase);
  });

  it("falls back to development for anything else", () => {
    expect(normalizeItpPhase(null)).toBe("development");
    expect(normalizeItpPhase(undefined)).toBe("development");
    expect(normalizeItpPhase("")).toBe("development");
    expect(normalizeItpPhase("Execution")).toBe("development"); // case-sensitive: the DB stores lower-case
    expect(normalizeItpPhase("closed")).toBe("development");
  });
});

describe("phase display tables", () => {
  it("define a label and a tone for every phase, in lifecycle order", () => {
    expect(ITP_PHASES).toEqual(["development", "execution", "handover"]);
    for (const phase of ITP_PHASES) {
      expect(ITP_PHASE_LABEL[phase]).toBeTruthy();
      expect(["neutral", "warning", "success"]).toContain(ITP_PHASE_TONE[phase]);
    }
  });
});
