import { describe, expect, it } from "vitest";
import { solveAnchorChallenge } from "./anchor";

describe("Anchor Browser challenge solver", () => {
  it("computes a safe integer expression without dynamic evaluation", () => {
    expect(solveAnchorChallenge("Compute (12 + 8) * 3 - 10")).toBe(50);
  });

  it("rejects unsupported non-integer arithmetic", () => {
    expect(() => solveAnchorChallenge("Solve 7 / 2")).toThrow("integer");
  });
});
