import { describe, expect, it } from "vitest";
import { spellAttrsFor } from "../spellcheck";

const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as Parameters<typeof spellAttrsFor>[0];

describe("spellAttrsFor", () => {
  it("checks and corrects free-text areas", () => {
    expect(spellAttrsFor(el("TEXTAREA", { name: "reason" }))).toEqual({ spellcheck: "true", autocorrect: "on", autocapitalize: "sentences" });
  });
  it("leaves emails, passwords, numbers and dates alone", () => {
    for (const type of ["email", "password", "number", "date", "tel", "url", "search"]) {
      expect(spellAttrsFor(el("INPUT", { type, name: "x" }))).toBeNull();
    }
  });
  it("leaves identifier-like text fields alone", () => {
    for (const name of ["itp_number", "serial_no", "equipment_tag", "client_code", "document_reference", "contact_email", "project_id", "heat"]) {
      const r = spellAttrsFor(el("INPUT", { type: "text", name }));
      if (name === "heat") expect(r).not.toBeNull();
      else expect(r).toBeNull();
    }
  });
  it("underlines names but never auto-rewrites them", () => {
    expect(spellAttrsFor(el("INPUT", { type: "text", name: "party_name" }))).toEqual({ spellcheck: "true", autocorrect: "off", autocapitalize: "words" });
  });
  it("underlines but never rewrites a list of zone names", () => {
    expect(spellAttrsFor(el("TEXTAREA", { name: "locations" }))).toEqual({ spellcheck: "true", autocorrect: "off", autocapitalize: "words" });
  });
  it("respects an explicit opt-out", () => {
    expect(spellAttrsFor(el("TEXTAREA", { dataset: { noSpell: "" } }))).toBeNull();
  });
  it("ignores other elements", () => {
    expect(spellAttrsFor(el("SELECT"))).toBeNull();
  });
});
