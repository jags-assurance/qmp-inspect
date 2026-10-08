import { describe, expect, it } from "vitest";
import { REGISTER_CSV_COLUMNS, type CsvRegisterKind } from "../csv-columns";

const KINDS = Object.keys(REGISTER_CSV_COLUMNS) as CsvRegisterKind[];

describe("REGISTER_CSV_COLUMNS", () => {
  it("covers the four register kinds", () => {
    expect([...KINDS].sort()).toEqual(["calibration", "material", "personnel", "welder"]);
  });

  for (const kind of KINDS) {
    describe(kind, () => {
      const columns = REGISTER_CSV_COLUMNS[kind];

      it("has unique headers and unique database fields", () => {
        expect(new Set(columns.map((c) => c.header)).size).toBe(columns.length);
        expect(new Set(columns.map((c) => c.field)).size).toBe(columns.length);
      });

      it("uses headers the importer can match after its own normalisation (lower-case, [a-z0-9_] only)", () => {
        for (const column of columns) expect(column.header).toMatch(/^[a-z0-9_]+$/);
      });

      it("requires at least one column, and requires the expiry/due date where the register has one", () => {
        expect(columns.some((c) => c.required)).toBe(true);
        const dateField = kind === "calibration" ? "due_date" : kind === "material" ? null : "expiry_date";
        if (dateField) expect(columns.find((c) => c.field === dateField)?.required).toBe(true);
      });

      it("marks every *_date column as a date", () => {
        for (const column of columns.filter((c) => c.field.endsWith("_date"))) expect(column.kind).toBe("date");
      });
    });
  }
});
