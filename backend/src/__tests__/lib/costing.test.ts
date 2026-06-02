import {
  weightedAverageCost,
  calculateCOGSFromDepletion,
} from "../../lib/costing";

describe("weightedAverageCost", () => {
  it("calculates weighted average for standard case", () => {
    // 50 lbs @ $3.20 + 20 lbs @ $3.50 = 70 lbs @ $3.2857
    expect(weightedAverageCost(50, 3.2, 20, 3.5)).toBe(3.2857);
  });

  it("returns existing cost when incoming quantity is zero", () => {
    expect(weightedAverageCost(50, 3.2, 0, 5.0)).toBe(3.2);
  });

  it("returns incoming cost when existing quantity is zero (first purchase)", () => {
    // (0 × 3.20 + 20 × 3.50) / 20 = 3.50
    expect(weightedAverageCost(0, 0, 20, 3.5)).toBe(3.5);
  });

  it("handles price increases (new vendor, higher price)", () => {
    // (100×2 + 50×4) / 150 = 2.6667
    expect(weightedAverageCost(100, 2.0, 50, 4.0)).toBe(2.6667);
  });

  it("handles price decreases (bulk discount)", () => {
    // (100×4 + 50×2) / 150 = 3.3333
    expect(weightedAverageCost(100, 4.0, 50, 2.0)).toBe(3.3333);
  });

  it("rounds to exactly 4 decimal places", () => {
    // (7×1.234 + 3×2.567) / 10 = 1.6339
    const result = weightedAverageCost(7, 1.234, 3, 2.567);
    expect(result).toBe(1.6339);
    const decimals = result.toString().split(".")[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(4);
  });

  it("throws when any parameter is NaN", () => {
    expect(() => weightedAverageCost(NaN, 3.2, 20, 3.5)).toThrow("NaN detected");
    expect(() => weightedAverageCost(50, NaN, 20, 3.5)).toThrow("NaN detected");
    expect(() => weightedAverageCost(50, 3.2, NaN, 3.5)).toThrow("NaN detected");
    expect(() => weightedAverageCost(50, 3.2, 20, NaN)).toThrow("NaN detected");
  });

  it("throws when a quantity is negative", () => {
    expect(() => weightedAverageCost(-50, 3.2, 20, 3.5)).toThrow("negative quantity");
    expect(() => weightedAverageCost(50, 3.2, -20, 3.5)).toThrow("negative quantity");
  });

  it("throws when a cost is negative", () => {
    expect(() => weightedAverageCost(50, -3.2, 20, 3.5)).toThrow("negative cost");
    expect(() => weightedAverageCost(50, 3.2, 20, -3.5)).toThrow("negative cost");
  });
});

describe("calculateCOGSFromDepletion", () => {
  it("uses snapshot unitCost when present", () => {
    expect(calculateCOGSFromDepletion(-10, 3.25, 3.2)).toBe(32.5);
  });

  it("falls back to product costPerUnit for legacy records (null unitCost)", () => {
    expect(calculateCOGSFromDepletion(-10, null, 3.2)).toBe(32.0);
  });

  it("handles absolute value of change (depletion is negative)", () => {
    expect(calculateCOGSFromDepletion(-25, 2.0, 1.5)).toBe(50.0);
  });

  it("returns zero for a zero-change log", () => {
    expect(calculateCOGSFromDepletion(0, 3.0, 3.0)).toBe(0);
  });
});
