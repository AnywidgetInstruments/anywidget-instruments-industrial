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

describe("hexadecimal, binary and octal formats (IND-110)", () => {
  it("formats integers in the base, with zero padding", async () => {
    expect(formatValue(31, "%x")).toBe("1f");
    expect(formatValue(31, "%04X")).toBe("001F");
    expect(formatValue(5, "%08b")).toBe("00000101");
    expect(formatValue(8, "%o")).toBe("10");
    expect(formatValue(30.6, "%X")).toBe("1F");
    expect(formatValue(-31, "%04X")).toBe("-01F");
    expect(formatValue(31, "0x%04X")).toBe("0x001F");
    expect(formatValue(12.5, "%6.1f")).toBe("  12.5");
    expect(formatValue(NaN, "%04X")).toBe("NaN");
    expect(tickFormat("%04X")).toBe("%X");
  });
  it("parses entries in the base of the format", async () => {
    const { parseEntry, radixOf } = await import("../src/core/format.js");
    const { checkEntry } = await import("../src/core/entry.js");
    expect(radixOf("%04X")).toBe(16);
    expect(radixOf("%.2f")).toBe(10);
    expect(parseEntry("1F", "", 16)).toBe(31);
    expect(parseEntry("0x1f")).toBe(31);
    expect(parseEntry("0b101")).toBe(5);
    expect(parseEntry("-0o17")).toBe(-15);
    expect(parseEntry("102", "", 2)).toBeNaN();
    expect(parseEntry("1.5", "", 16)).toBeNaN();
    expect(parseEntry("12", "", 10)).toBe(12);
    expect(checkEntry("FF", { min: 0, max: 65535, format: "%04X" })).toEqual({ ok: true, value: 255 });
    const r = checkEntry("1FFFF", { min: 0, max: 65535, format: "%04X" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("0000 … FFFF");
  });
  it("keypad: hexadecimal keys and digits of the base", async () => {
    const { editDraft, keyAllowed } = await import("../src/widgets/keypad.js");
    expect(editDraft("1", "F")).toBe("1F");
    expect(editDraft("1", "hexC")).toBe("1C");
    expect(editDraft("1F", "clear")).toBe("");
    expect(keyAllowed("F", 16)).toBe(true);
    expect(keyAllowed("F", 10)).toBe(false);
    expect(keyAllowed("2", 2)).toBe(false);
    expect(keyAllowed(".", 16)).toBe(false);
    expect(keyAllowed("enter", 2)).toBe(true);
  });
});
