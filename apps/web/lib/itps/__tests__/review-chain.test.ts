import { describe, expect, it } from "vitest";
import { chainProblemMessage, chainReviewerProblems } from "../review-chain";

const chain = [
  { reviewerUserId: "u1", reviewerName: "Ann" },
  { reviewerUserId: "u2", reviewerName: "Bob" },
  { reviewerUserId: "u3", reviewerName: "Cy" },
  { reviewerUserId: "u4", reviewerName: "Dee" },
];

describe("chainReviewerProblems (M3)", () => {
  it("reports deactivated, no-access and missing reviewers only", () => {
    const users = [
      { id: "u1", full_name: "Ann", is_active: true },
      { id: "u2", full_name: "Bob", is_active: false },
      { id: "u3", full_name: "Cy", is_active: true },
    ];
    const problems = chainReviewerProblems(chain, users, new Set(["u1", "u2"]));
    expect(problems.map((p) => [p.userId, p.reason])).toEqual([
      ["u2", "deactivated"],
      ["u3", "no_access"],
      ["u4", "not_found"],
    ]);
    expect(chainProblemMessage(problems)).toMatch(/Bob \(is deactivated\); Cy \(no longer has access to this project\)/);
  });
  it("is empty when everyone is fine", () => {
    expect(chainReviewerProblems(chain.slice(0, 1), [{ id: "u1", full_name: "Ann", is_active: null }], new Set(["u1"]))).toEqual([]);
  });
});
