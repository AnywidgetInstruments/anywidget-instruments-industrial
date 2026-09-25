// Front-end side of the parity cases shared with the kernel (HOST-005):
// tests/parity/*.json, also run by tests/test_parity.py.
import { describe, expect, test } from "vitest";
import alarmCases from "../../tests/parity/alarm_level.json";
import alarmTables from "../../tests/parity/alarms.json";
import annCases from "../../tests/parity/annunciator.json";
import barCases from "../../tests/parity/bars.json";
import digitalCases from "../../tests/parity/digital.json";
import intensityCases from "../../tests/parity/intensity.json";
import numericCases from "../../tests/parity/numeric.json";
import peakCases from "../../tests/parity/peak.json";
import polarCases from "../../tests/parity/polar.json";
import pidCases from "../../tests/parity/pid.json";
import processCases from "../../tests/parity/process.json";
import resolvedCases from "../../tests/parity/resolved.json";
import machineCases from "../../tests/parity/statemachine.json";
import stateCases from "../../tests/parity/states.json";
import synopticCases from "../../tests/parity/synoptic.json";
import trendCases from "../../tests/parity/trend.json";
import waveformCases from "../../tests/parity/waveform.json";
import { type AlarmLevel, type AlarmLimits, computeAlarmLevel } from "../src/contract/alarm.js";
import { acknowledgeRows, type AlarmRow, expireShelving, localIso, shelveRow, unshelveRow } from "../src/contract/alarms.js";
import { type AnnEvent, annunciatorTransition, hornOn, type Panel, panelAction, type Sequence, setProcess } from "../src/contract/annunciator.js";
import { barLevels, normalizeBars } from "../src/contract/bars.js";
import { decodeDigital, digitalValuesAt } from "../src/contract/digital.js";
import { selectorValue, stackStates } from "../src/contract/industrial.js";
import { RowRing, rowIndexAt } from "../src/contract/intensity.js";
import { coerceValue, validScale } from "../src/contract/numeric.js";
import { nextPeak, type PeakState } from "../src/contract/peak.js";
import { gammaToZ, radarRange, zToGamma } from "../src/contract/polar.js";
import { pidState } from "../src/contract/derived.js";
import { loopModeChange, operatorSet } from "../src/contract/pid.js";
import { positionDemand, processCommand, type ProcessState } from "../src/contract/process.js";
import { availableCommands, type Machine, nextState, normalizeMachine, SC } from "../src/contract/statemachine.js";
import { imageMime } from "../src/contract/synoptic.js";
import { readTrait } from "../src/contract/traits.js";
import { normalizePen, PenRing } from "../src/contract/trend.js";
import { Ring, valuesAt } from "../src/contract/waveform.js";
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

describe("PID faceplate operator rules", () => {
  for (const c of pidCases.cases) {
    test(c.name, () => {
      const spec = CONTRACTS.PIDFaceplate.traits;
      const state: Record<string, unknown> = Object.fromEntries(Object.entries(spec).map(([k, s]) => [k, readTrait(s, s.default)]));
      Object.assign(state, c.traits, "pv" in c.traits ? { pv: parseNumber((c.traits as { pv: unknown }).pv) } : {});
      for (const [step, expected] of c.steps as Array<[unknown[], Record<string, unknown>]>) {
        const s = pidState((k) => state[k]);
        if (step[0] === "set") {
          const r = operatorSet(s, String(step[1]), step[2], !!step[3]);
          if (r.ok) state[r.field] = r.value;
        } else {
          const r = loopModeChange(s, String(step[1]));
          if (r.ok) Object.assign(state, r.changes);
        }
        for (const [name, v] of Object.entries(expected)) expect(state[name], `${c.name}: ${JSON.stringify(step)} ${name}`).toEqual(v);
      }
    });
  }
});

describe("annunciator", () => {
  test("every transition of the three sequences", () => {
    for (const [state, active, event, sequence, expected] of annCases.transitions as Array<[string, boolean, AnnEvent, Sequence, string]>) {
      expect(annunciatorTransition(state, active, event, sequence), `${state} ${active} ${event} ${sequence}`).toBe(expected);
    }
  });
  for (const c of annCases.scenarios) {
    test(c.name, () => {
      let p: Panel = { sequence: c.sequence as Sequence, firstOut: c.first_out, silenced: false, windows: c.windows.map((tag) => ({ tag, text: tag, color: "amber", active: false, state: "normal", first: false })) };
      for (const [[action, arg], windows, horn] of c.steps as Array<[[string, [string, boolean] | null], Record<string, [string, boolean]>, boolean]>) {
        p = action === "set" ? setProcess(p, ...(arg as [string, boolean])) : panelAction(p, action as "acknowledge" | "reset" | "silence");
        const got = Object.fromEntries(p.windows.map((w) => [w.tag, [w.state, w.first]]));
        expect([got, hornOn(p)], `${c.name}: ${action}`).toEqual([windows, horn]);
      }
    });
  }
});

describe("alarm banner and alarm list", () => {
  const table = CONTRACTS.AlarmIndicator.traits.value.transitions;
  const now0 = alarmTables.now * 1000;
  const rowsOf = (rows: Array<Record<string, unknown>>, list: boolean, now: number): AlarmRow[] =>
    rows.map((r) => ({ id: String(r.id), state: String(r.state), ...(list ? { shelved_until: r.shelved_for == null ? null : localIso(now + Number(r.shelved_for) * 1000), suppressed: !!r.suppressed, out_of_service: false } : {}) }));
  const stateOf = (rows: AlarmRow[]) => Object.fromEntries(rows.map((r) => [r.id, [r.state, r.shelved_until != null]]));

  for (const c of alarmTables.banner) {
    test(`banner: ${c.name}`, () => {
      let rows = rowsOf(c.rows, false, now0);
      for (const [step, expected] of c.steps as Array<[unknown[], Record<string, unknown>]>) {
        rows = acknowledgeRows(rows, step[0] === "ack" ? String(step[1]) : null, table, false);
        expect(stateOf(rows), JSON.stringify(step)).toEqual(expected);
      }
    });
  }
  for (const c of alarmTables.list) {
    test(`list: ${c.name}`, () => {
      let now = now0;
      let rows = rowsOf(c.rows, true, now);
      for (const [step, expected] of c.steps as Array<[unknown[], Record<string, unknown>]>) {
        if (step[0] === "ack") rows = acknowledgeRows(rows, String(step[1]), table, true);
        else if (step[0] === "shelve") rows = shelveRow(rows, String(step[1]), Number(step[2]), c.max_shelve, now) ?? rows;
        else if (step[0] === "unshelve") rows = unshelveRow(rows, String(step[1]));
        else {
          now += Number(step[1]) * 1000;
          rows = expireShelving(rows, now).rows;
        }
        expect(stateOf(rows), JSON.stringify(step)).toEqual(expected);
      }
    });
  }
});

describe("polar family", () => {
  const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12));
  test.each(polarCases.gamma)("gamma %#", (c) => close(zToGamma(c.z[0], c.z[1], c.z0), c.gamma));
  test.each(polarCases.impedance)("impedance %#", (c) => close(gammaToZ(c.gamma[0], c.gamma[1]), c.z));
  for (const c of polarCases.radar_ranges) {
    test(c.name, () => {
      expect(c.expected.map((_, k) => radarRange(c.ranges, c.values, k))).toEqual(c.expected);
    });
  }
});

describe("waveform chart", () => {
  for (const c of waveformCases.cases) {
    test(c.name, () => {
      const ring = new Ring(c.history, c.n_traces);
      for (const rows of c.appends) ring.push(Float32Array.from(rows.flat().map((v) => parseNumber(v))), rows.length);
      for (const [x, expected] of c.cursors as Array<[number, Array<number | string>]>) {
        const got = valuesAt(ring, x, { mode: c.update_mode, dt: c.dt });
        expect(got.map((v) => (Number.isNaN(v) ? null : v)), `${c.name} x=${x}`).toEqual(expected.map((v) => (typeof v === "string" ? null : v)));
      }
    });
  }
});

describe("intensity chart", () => {
  for (const c of intensityCases.cases) {
    test(c.name, () => {
      const ring = new RowRing(c.history, c.n_bins);
      let total = 0;
      for (const rows of c.appends) {
        total += rows.length;
        ring.store(Float32Array.from(rows.flat()), rows.length, total);
      }
      for (const [x, expected] of c.cursors as Array<[number, number[]]>) {
        expect(Array.from(ring.row(rowIndexAt(x, c.dt)) ?? []), `${c.name} x=${x}`).toEqual(expected);
      }
    });
  }
});

describe("digital and mixed-signal graphs", () => {
  for (const c of digitalCases.cases) {
    test(c.name, () => {
      // integers unpacked LSB first, as the host sends them: one byte per line
      const bits = Uint8Array.from(c.values.flatMap((v) => Array.from({ length: c.n_bits }, (_, k) => (v >> k) & 1)));
      const analog = c.analog ?? [];
      const data = decodeDigital(
        { n_samples: c.values.length, n_lines: c.n_bits, n_analog: analog.length, n_traces: analog[0]?.length ?? 0 },
        [bits.buffer, Float32Array.from(analog.flat()).buffer],
      );
      for (const [x, expected] of c.cursors as Array<[number, Array<number | string>]>) {
        expect(digitalValuesAt(data, x, { x0: c.x0, dt: c.dt, buses: c.buses }), `${c.name} x=${x}`).toEqual(expected);
      }
    });
  }
});

describe("trend chart", () => {
  test.each(trendCases.normalize)("pens %#", (c) => {
    expect(c.pens.map((p, j) => normalizePen(p, j))).toEqual(c.expected);
  });
  for (const c of trendCases.values_at) {
    test(c.name, () => {
      const rings = new Map(c.pens.map((p) => [p, new PenRing(c.history)]));
      for (const [pen, values, times] of c.adds as Array<[string, number[], number[]]>) rings.get(pen)?.push(times, Float32Array.from(values), values.length);
      for (const [x, expected] of c.cursors as Array<[number, Array<number | string>]>) {
        const got = c.pens.map((p) => rings.get(p)?.at(x) ?? NaN);
        expect(got.map((v) => (Number.isNaN(v) ? null : v)), `${c.name} x=${x}`).toEqual(expected.map((v) => (typeof v === "string" ? null : v)));
      }
    });
  }
});

describe("synoptic background", () => {
  test.each(synopticCases.cases)("$name", (c) => {
    const bytes = Uint8Array.from(c.hex.match(/../g) ?? [], (h) => parseInt(h, 16));
    expect(imageMime(bytes)).toBe(c.mime);
  });
});
