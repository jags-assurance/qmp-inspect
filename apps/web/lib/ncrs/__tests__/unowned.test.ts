import { describe, expect, it } from "vitest";
import { pickUnownedNcrRecipients } from "../unowned";

describe("pickUnownedNcrRecipients", () => {
  it("prefers team leads over general staff", () => {
    expect(pickUnownedNcrRecipients(["lead"], ["admin1", "admin2"], "raiser")).toEqual(["lead"]);
  });
  it("falls back to admin staff when there is no team lead", () => {
    expect(pickUnownedNcrRecipients([], ["admin1", "admin1", "admin2"], null)).toEqual(["admin1", "admin2"]);
  });
  it("never notifies the person who raised it", () => {
    expect(pickUnownedNcrRecipients([], ["raiser", "admin1"], "raiser")).toEqual(["admin1"]);
    expect(pickUnownedNcrRecipients(["raiser"], ["admin1"], "raiser")).toEqual([]);
  });
});

import { pickWithdrawRecipients } from "../unowned";

describe("pickWithdrawRecipients", () => {
  it("combines raiser, owner, party members and leads without duplicates", () => {
    expect(pickWithdrawRecipients(["raiser", "assignee", "m1", "lead", "m1", null, undefined], "actor")).toEqual(["raiser", "assignee", "m1", "lead"]);
  });
  it("never notifies the person withdrawing", () => {
    expect(pickWithdrawRecipients(["actor", "raiser"], "actor")).toEqual(["raiser"]);
  });
});
