// Front-end side of the parity cases shared with the kernel (HOST-005):
// tests/parity/*.json, also run by tests/test_parity.py.
import { describe, expect, test } from "vitest";
import alarmCases from "../../tests/parity/alarm_level.json";
import barCases from "../../tests/parity/bars.json";
import numericCases from "../../tests/parity/numeric.json";
import peakCases from "../../tests/parity/peak.json";
import processCases from "../../tests/parity/process.json";
import resolvedCases from "../../tests/parity/resolved.json";
import machineCases from "../../tests/parity/statemachine.json";
import stateCases from "../../tests/parity/states.json";
import { type AlarmLevel, type AlarmLimits, computeAlarmLevel } from "../src/contract/alarm.js";
import { barLevels, normalizeBars } from "../src/contract/bars.js";
import { selectorValue, stackStates } from "../src/contract/industrial.js";
import { coerceValue, validScale } from "../src/contract/numeric.js";
import { nextPeak, type PeakState } from "../src/contract/peak.js";
import { positionDemand, processCommand, type ProcessState } from "../src/contract/process.js";
import { availableCommands, type Machine, nextState, normalizeMachine, SC } from "../src/contract/statemachine.js";
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
  test.each(numericCases.modulo)("$widget value $value wraps to $expected", (c) => {
    const spec = CONTRACTS[c.widget as keyof typeof CONTRACTS].traits.value;
    const v = readTrait(spec, c.value) as number;
    const expected = parseNumber(c.expected);
    expect(Number.isNaN(expected) ? Number.isNaN(v) : v === expected).toBe(true);
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

describe("peak hold", () => {
  for (const c of peakCases.cases) {
    test(c.name, () => {
      let state: PeakState = { peak: null, time: 0 };
      let previous: number | undefined;
      for (const [now, value, expected] of c.steps as Array<[number, number | string, number | null]>) {
        const v = parseNumber(value);
        // like the models, a repeated value is not a change event
        if (!Object.is(v, previous)) state = nextPeak(v, state, { hold: c.hold, decay: c.decay, now }) ?? state;
        previous = v;
        expect(state.peak, `${c.name} at ${now}`).toBe(expected);
      }
    });
  }
});

describe("resolved defaults", () => {
  test.each(resolvedCases.selector)("selector $positions (default $default_position) -> $expected", (c) => {
    expect(selectorValue(c.positions, (c as { value?: string }).value ?? "", c.default_position)).toBe(c.expected);
  });
  test.each(resolvedCases.stacklight)("stack light $tiers from $value -> $expected", (c) => {
    expect(stackStates(c.tiers, c.value ?? [])).toEqual(c.expected);
  });
});

describe("bar graph", () => {
  test.each(barCases.normalize)("bars %#", (c) => {
    expect(normalizeBars(c.bars)).toEqual(c.expected);
  });
  for (const c of barCases.levels) {
    test(c.name, () => {
      const bars = normalizeBars(c.bars);
      let levels: string[] = [];
      for (const [values, expected] of c.steps as Array<[Array<number | string>, string[]]>) {
        levels = barLevels(values.map(parseNumber), bars, c.deadband, levels);
        expect(levels, `${c.name} at ${JSON.stringify(values)}`).toEqual(expected);
      }
    });
  }
});

describe("process object commands", () => {
  for (const c of processCases.cases) {
    test(c.name, () => {
      const spec = CONTRACTS[c.widget as keyof typeof CONTRACTS].traits;
      const state: Record<string, unknown> = Object.fromEntries(Object.entries(spec).map(([k, s]) => [k, s.default]));
      Object.assign(state, c.traits);
      for (const [command, expected] of c.steps as Array<[string | [string, number], Record<string, unknown>]>) {
        const s: ProcessState = {
          auto: !!state.auto,
          simulate: !!state.simulate,
          commands: state.commands as string[],
          simulated: spec.commands.simulated ?? {},
          position: (state.position as number | null) ?? null,
        };
        Object.assign(state, Array.isArray(command) ? positionDemand(command[1], s) : processCommand(command, s));
        for (const [name, v] of Object.entries(expected)) expect(state[name], `${c.name}: ${String(command)} ${name}`).toEqual(v);
      }
    });
  }
});

describe("state machine", () => {
  test.each(machineCases.normalize)("model %#", (c) => {
    expect(normalizeMachine(c.model)).toEqual(c.expected);
  });
  test.each(machineCases.invalid)("invalid model %#", (m) => {
    expect(normalizeMachine(m)).toBeNull();
  });
  for (const c of machineCases.sequences) {
    test(c.name, () => {
      const m = (c.model ? normalizeMachine(c.model) : normalizeMachine(CONTRACTS.StateMachine.traits.machine.default)) as Machine;
      let state = m.initial;
      for (const [command, expected, available] of c.steps as Array<[string, string, string[]]>) {
        // SC is a host event; operator commands never apply it
        const next = command === SC ? nextState(m, state, SC) : nextState(m, state, command);
        if (next !== null) state = next;
        expect([state, availableCommands(m, state)], `${c.name}: ${command}`).toEqual([expected, available]);
      }
    });
  }
});
