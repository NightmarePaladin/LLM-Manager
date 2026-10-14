import { describe, expect, it } from "vitest";
import { isSecretCode, nonsenseLine } from "@/lib/prank";

describe("isSecretCode", () => {
  it("accepts the code regardless of case and surrounding spaces", () => {
    expect(isSecretCode("bald")).toBe(true);
    expect(isSecretCode("  BALD ")).toBe(true);
    expect(isSecretCode("Bald")).toBe(true);
  });

  it.each(["", "bal", "baldy", "ba ld", "hair", "0", "bald; drop table"])("rejects %j", (input) => {
    expect(isSecretCode(input)).toBe(false);
  });
});

describe("nonsenseLine", () => {
  it("always returns a non-empty single line, whatever the random source", () => {
    for (const r of [0, 0.1, 0.34, 0.5, 0.67, 0.84, 0.999999]) {
      const line = nonsenseLine(() => r);
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toContain("\n");
    }
    let seed = 1;
    const lcg = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const lines = new Set(Array.from({ length: 200 }, () => nonsenseLine(lcg)));
    expect(lines.size).toBeGreaterThan(100); // plenty of variety
  });
});
