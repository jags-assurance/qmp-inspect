import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { extractTextFromFile } from "../extract-text";

// The sample ITP source documents used by the Real-World Test Playbook (docs/sample-itp-sources).
// Checks each one extracts the way the vault upload will, and that the clause numbers and limits the
// AI draft must cite actually survive extraction (a value lost here can never appear in the draft).
const DIR = join(__dirname, "../../../../../docs/sample-itp-sources");

async function extract(rel: string) {
  const buf = readFileSync(join(DIR, rel));
  return extractTextFromFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), rel);
}

const SOURCES: { file: string; mustContain: string[] }[] = [
  {
    file: "THP-SPEC-E-001_RevA_LV_Switchroom_Specification.docx",
    mustContain: ["THP-SPEC-E-001", "3.1", "1600 A", "1.5 m", "12 x overall cable diameter", "1 ohm", "0.5 ohm", "7.1", "1000 V DC", "100 megohm", "HOLD POINT", "300 ms", "40 ms", "THP-PCS-001", "WITNESS POINT", "415 V +/- 6 %"],
  },
  {
    file: "THP-ES-200_Rev1_Client_Electrical_Standard.pdf",
    mustContain: ["THP-ES-200", "Hold points", "48 hours", ">= 100 Mohm", "<= 0.5 ohm", "<= 1 ohm", "<= 300 ms", "0.16", "0.40"],
  },
  {
    file: "THP-MS-E-003_RevA_Method_Statement.docx",
    mustContain: ["THP-MS-E-003", "Receiving inspection", "Terminations", "Insulation resistance", "HOLD (H)", "WITNESS (W)", "First energisation", "Functional test"],
  },
  {
    file: "THP-DWG-E-101_RevA_SLD_and_Cable_Schedule.pdf",
    mustContain: ["THP-DWG-E-101", "MSB-04", "C-F1", "DB-4D", "MCCB 250A", "Level within 2 mm/m", "1000 V DC"],
  },
  {
    file: "THP-MAT-E-002_RevA_Material_Submittal_Schedule.txt",
    mustContain: ["THP-MAT-E-002", "Item 1", "mill certificate", "Quarantined"],
  },
];

describe("sample ITP source documents", () => {
  for (const { file, mustContain } of SOURCES) {
    it(`${file} extracts with its key requirements`, async () => {
      const out = await extract(file);
      expect(out.status).toBe("done");
      if (out.status !== "done") return;
      const flat = out.text.replace(/\s+/g, " ");
      for (const needle of mustContain) expect(flat).toContain(needle);
    });
  }

  it("image-only PDF is 'empty', so it is never offered as AI source material", async () => {
    expect((await extract("negative-tests/scanned-no-text-layer.pdf")).status).toBe("empty");
  });

  it("a shell script is 'unsupported' for extraction", async () => {
    expect((await extract("negative-tests/refuse-me.sh")).status).toBe("unsupported");
  });
});
