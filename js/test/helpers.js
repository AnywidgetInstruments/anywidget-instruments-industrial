// Shared test helpers: an in-memory anywidget model (AFM interface).

export function fakeModel(state) {
  const handlers = {};
  const sent = [];
  return {
    sent,
    get: (k) => state[k],
    set: (k, v) => { state[k] = v; },
    save_changes: () => sent.push({ ...state }),
    on: (ev, cb) => { (handlers[ev] ||= []).push(cb); },
    off: (ev, cb) => { handlers[ev] = (handlers[ev] || []).filter((h) => h !== cb); },
    send: (msg) => sent.push(msg),
    emit: (ev, ...args) => (handlers[ev] || []).forEach((h) => h(...args)),
  };
}

export const common = { mode: "control", label: "<b>Gain</b>", disabled: false, visible: true, tooltip: "", size: [160, 160], style: "modern", skin: {} };
