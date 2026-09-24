// Front-end side of the parity cases shared with the kernel (HOST-005):
// tests/parity/*.json, also run by tests/test_parity.py.
import { describe, expect, test } from "vitest";
import alarmCases from "../../tests/parity/alarm_level.json";
import numericCases from "../../tests/parity/numeric.json";
import stateCases from "../../tests/parity/states.json";
import { type AlarmLevel, type AlarmLimits, computeAlarmLevel } from "../src/contract/alarm.js";
import { coerceValue, validScale } from "../src/contract/numeric.js";
import { readTrait } from "../src/contract/traits.js";
import { parseNumber } from "../src/core/scale.js";
import { CONTRACTS } from "../src/generated/contract.js";

type Step = [number | string, string] | [Record<string, number | null>, number | string, string];

describe("alarm level", () => {
  for (const c of alarmCases.cases) {
    test(c.name, () => {
      const limits: AlarmLimits = { ...(c.limits as AlarmLimits) };
      let previous: AlarmLevel = "normal";
      for (const raw of c.steps as Step[]) {
        let step = raw as unknown[];
        if (typeof step[0] === "object") {
          Object.assign(limits, step[0]);
          step = step.slice(1);
        }
        const value = parseNumber(step[0]);
        previous = computeAlarmLevel(value, { ...limits, previous });
        expect(previous, `${c.name} at ${String(step[0])}`).toBe(step[1]);
      }
    });
  }
});

describe("numeric rules", () => {
  test.each(numericCases.coerce)("coerce $value in [$min, $max] ($coerce)", (c) => {
    const v = coerceValue(parseNumber(c.value), c.min, c.max, c.coerce);
    expect(Object.is(v, parseNumber(c.expected)) || v === parseNumber(c.expected)).toBe(true);
  });
  test.each(numericCases.scale)("scale $min .. $max ($scale) valid: $valid", (c) => {
    expect(validScale(c)).toBe(c.valid);
  });
});

describe("states accepted by the kernel are read unchanged", () => {
  stateCases.states.forEach((s, i) => {
    test(`${s.widget}-${i}`, () => {
      const contract = CONTRACTS[s.widget as keyof typeof CONTRACTS];
      for (const [name, raw] of Object.entries(s.traits)) {
        const spec = contract.traits[name];
        expect(spec, name).toBeDefined();
        let invalid = false;
        const v = readTrait(spec, raw, () => (invalid = true));
        expect(invalid, name).toBe(false);
        expect(v, name).toEqual(spec.nonfinite ? parseNumber(raw) : raw);
      }
    });
  });
});
