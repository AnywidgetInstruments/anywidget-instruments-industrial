// Alarm banner and alarm list operator actions (SCADA-006, SCADA-007,
// IND-050 .. IND-053): the front-end port of AlarmBanner._apply and
// AlarmList.acknowledge / shelve / unshelve / refresh
// (src/anywidget_instruments/_scada.py, _alarmlist.py), applied when no host
// owns the state. Checked against the shared cases of tests/parity/alarms.json.
import { applyTransition, type Transitions } from "./transitions.js";

export interface AlarmRow {
  id: string;
  state: string;
  shelved_until?: string | null;
  suppressed?: boolean;
  out_of_service?: boolean;
  [key: string]: unknown;
}

/** A row stays listed while not normal; in an alarm list also while shelved, suppressed or out of service. */
export function keepRow(r: AlarmRow, list: boolean): boolean {
  return r.state !== "normal" || (list && (r.shelved_until != null || !!r.suppressed || !!r.out_of_service));
}

/** Acknowledge one alarm (or every alarm when `id` is null) with the ISA-18.2 table. */
export function acknowledgeRows(rows: readonly AlarmRow[], id: string | null, table: Transitions | undefined, list: boolean): AlarmRow[] {
  return rows
    .map((r) => (id === null || r.id === id ? { ...r, state: applyTransition(table, r.state, "acknowledge") } : r))
    .filter((r) => keepRow(r, list));
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Local "YYYY-MM-DDTHH:MM:SS" of a time in ms, as datetime.fromtimestamp(...).isoformat(timespec="seconds"). */
export function localIso(ms: number): string {
  const d = new Date(Math.floor(ms / 1000) * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Time in ms of a local ISO time (a date-time without offset is local). */
export function isoMs(iso: string): number {
  return new Date(iso).getTime();
}

/** Shelve an alarm for `seconds` (0 < seconds <= maxShelve), or null when refused (IND-051). */
export function shelveRow(rows: readonly AlarmRow[], id: string, seconds: number, maxShelve: number, nowMs: number): AlarmRow[] | null {
  if (!(seconds > 0 && seconds <= maxShelve) || !rows.some((r) => r.id === id)) return null;
  return rows.map((r) => (r.id === id ? { ...r, shelved_until: localIso(nowMs + seconds * 1000) } : r));
}

export function unshelveRow(rows: readonly AlarmRow[], id: string): AlarmRow[] {
  return rows.map((r) => (r.id === id ? { ...r, shelved_until: null } : r)).filter((r) => keepRow(r, true));
}

/** Unshelve the alarms whose shelving time has passed. */
export function expireShelving(rows: readonly AlarmRow[], nowMs: number): { rows: AlarmRow[]; expired: string[] } {
  const expired = rows.filter((r) => r.shelved_until != null && isoMs(String(r.shelved_until)) <= nowMs).map((r) => r.id);
  if (!expired.length) return { rows: [...rows], expired };
  return { rows: rows.map((r) => (expired.includes(r.id) ? { ...r, shelved_until: null } : r)).filter((r) => keepRow(r, true)), expired };
}

/** Time in ms of the next shelving expiry, or null. */
export function nextExpiry(rows: readonly AlarmRow[]): number | null {
  const times = rows.filter((r) => r.shelved_until != null).map((r) => isoMs(String(r.shelved_until)));
  return times.length ? Math.min(...times) : null;
}
