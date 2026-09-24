import { describe, expect, it } from "vitest";
import { formatValue, tickFormat, withUnit } from "../src/core/format.js";

describe("formatValue", () => {
  it("fixed, scientific and general", () => {
    expect(formatValue(12.345, "%.2f")).toBe("12.35");
    expect(formatValue(12345, "%.2e")).toBe("1.23e+4");
    expect(formatValue(0.000123456, "%.3g")).toBe("0.000123");
  });
  it("engineering notation", () => {
    expect(formatValue(12345, "%.3n")).toBe("12.3e3");
    expect(formatValue(0.0047, "%.2n")).toBe("4.7e-3");
    expect(formatValue(999.96, "%.3n")).toBe("1.00e3");
  });
  it("SI prefixes", () => {
    expect(formatValue(4700, "%.2s")).toBe("4.7 k");
    expect(formatValue(0.000001, "%.1s")).toBe("1 µ");
    expect(formatValue(2.5e6, "%.2s")).toBe("2.5 M");
    expect(formatValue(12, "%.3s")).toBe("12.0");
    expect(withUnit(formatValue(4700, "%.2s"), "Ω")).toBe("4.7 kΩ");
    expect(withUnit(formatValue(12, "%.1f"), "V")).toBe("12.0 V");
  });
  it("keeps surrounding text and removes negative zero", () => {
    expect(formatValue(3.14159, "x = %.1f")).toBe("x = 3.1");
    expect(formatValue(-0.001, "%.1f")).toBe("0.0");
  });
  it("non-finite values", () => {
    expect(formatValue(NaN)).toBe("NaN");
    expect(formatValue(Infinity)).toBe("+Inf");
    expect(formatValue(-Infinity)).toBe("-Inf");
  });
  it("tick format", () => {
    expect(tickFormat("%.1f")).toBe("%.4g");
    expect(tickFormat("%.3s")).toBe("%.2s");
  });
});
