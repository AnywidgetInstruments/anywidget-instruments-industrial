import { describe, expect, it } from "vitest";
import {
  angleOf, autoscale, clamp, fromFraction, keyStep, linearHit, niceTicks, parseNumber, polar, position,
  rotaryHit, snap, ticks, toFraction,
} from "../src/core/scale.js";

describe("parseNumber", () => {
  it("decodes non-finite strings sent by the kernel", () => {
    expect(parseNumber("nan")).toBeNaN();
    expect(parseNumber("inf")).toBe(Infinity);
    expect(parseNumber("-inf")).toBe(-Infinity);
    expect(parseNumber(3.5)).toBe(3.5);
    expect(parseNumber(null)).toBeNaN();
  });
});

describe("mapping", () => {
  it("linear round trip", () => {
    expect(toFraction(25, 0, 100)).toBe(0.25);
    expect(fromFraction(0.25, 0, 100)).toBe(25);
  });
  it("log10 mapping", () => {
    expect(toFraction(10, 1, 1000, "log")).toBeCloseTo(1 / 3);
    expect(fromFraction(2 / 3, 1, 1000, "log")).toBeCloseTo(100);
  });
  it("clamps display position and flags out of range", () => {
    expect(position(150, 0, 100)).toEqual({ fraction: 1, over: true, under: false, invalid: false });
    expect(position(-5, 0, 100)).toEqual({ fraction: 0, over: false, under: true, invalid: false });
    expect(position(NaN, 0, 100).invalid).toBe(true);
    expect(position(Infinity, 0, 100).invalid).toBe(true);
    expect(position(0, 1, 100, "log").under).toBe(true);
  });
});

describe("snap", () => {
  it("snaps to multiples of step from min and clamps", () => {
    expect(snap(0.34, 0, 1, 0.1)).toBe(0.3);
    expect(snap(7.4, 2, 12, 2.5)).toBe(7);
    expect(snap(20, 0, 10, 1)).toBe(10);
    expect(snap(-3, 0, 10, 0)).toBe(0);
    expect(snap(3.14159, 0, 10, 0)).toBe(3.14159);
  });
  it("keyboard step falls back to 1 % of span", () => {
    expect(keyStep(0, 200, 0)).toBe(2);
    expect(keyStep(0, 200, 5)).toBe(5);
  });
  it("clamp", () => expect(clamp(5, 0, 3)).toBe(3));
});

describe("ticks", () => {
  it("linear major and minor ticks", () => {
    const t = ticks(0, 100, 5, 4);
    expect(t.major).toEqual([0, 20, 40, 60, 80, 100]);
    expect(t.minor).toHaveLength(20);
    expect(t.minor[0]).toBeCloseTo(4);
  });
  it("nice ticks for awkward limits, exact intervals on request", () => {
    expect(ticks(0.1, 30, 5, 0).major).toEqual([5, 10, 15, 20, 25, 30]);
    expect(ticks(-20, 120, 7, 1).major).toEqual([-20, 0, 20, 40, 60, 80, 100, 120]);
    expect(ticks(-20, 120, 7, 1).minor).toEqual([-10, 10, 30, 50, 70, 90, 110]);
    expect(ticks(0, 360, 8, 0, "linear", { nice: false }).major).toEqual([0, 45, 90, 135, 180, 225, 270, 315, 360]);
  });
  it("log ticks per decade", () => {
    const t = ticks(1, 1000, 5, 4, "log");
    expect(t.major).toEqual([1, 10, 100, 1000]);
    expect(t.minor).toContain(20);
    expect(t.minor).toHaveLength(24);
  });
});

describe("hit testing", () => {
  it("angles are clockwise from 12 o'clock", () => {
    expect(angleOf(0, 0, 0, -1)).toBeCloseTo(0);
    expect(angleOf(0, 0, 1, 0)).toBeCloseTo(90);
    expect(angleOf(0, 0, -1, 0)).toBeCloseTo(-90);
    const [x, y] = polar(100, 100, 10, 90);
    expect(x).toBeCloseTo(110);
    expect(y).toBeCloseTo(100);
  });
  it("rotary hit test with dead zone", () => {
    expect(rotaryHit(0, 0, 0, -1, 270)).toBeCloseTo(0.5);
    expect(rotaryHit(0, 0, 1, 0, 270)).toBeCloseTo(225 / 270);
    expect(rotaryHit(0, 0, 0, 1, 270)).toBeNull(); // straight down: dead zone
  });
  it("linear hit test", () => {
    expect(linearHit(50, 0, 200)).toBe(0.25);
    expect(linearHit(-10, 0, 200)).toBe(0);
    expect(linearHit(145, 190, 10)).toBe(0.25); // inverted (vertical) track
  });
});

describe("autoscale", () => {
  it("expands immediately", () => {
    const [lo, hi] = autoscale([-1, 1], -2, 3);
    expect(lo).toBeLessThan(-2);
    expect(hi).toBeGreaterThan(3);
  });
  it("keeps range while data stays inside (hysteresis)", () => {
    expect(autoscale([-1, 1], -0.8, 0.7)).toEqual([-1, 1]);
  });
  it("shrinks when data use less than half of the range", () => {
    const [lo, hi] = autoscale([-10, 10], -1, 1);
    expect(hi - lo).toBeLessThan(5);
  });
});

describe("niceTicks", () => {
  it("uses 1/2/5 steps", () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(-1.1, 1.1, 4)).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(niceTicks(2, 6, 5)).toEqual([2, 3, 4, 5, 6]);
    expect(niceTicks(0, 0.0001, 2)).toEqual([0, 0.00005, 0.0001]);
  });
});
