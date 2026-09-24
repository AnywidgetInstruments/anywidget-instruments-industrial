// The anywidget front-end module (AFM) model interface: the only host API the
// widgets use (get, set, save_changes, on, off, send). Every host provides
// it: Jupyter, marimo, VS Code, JupyterLite, and hosts without a Python
// kernel that bind the model to a plain dictionary of traits.

export type Buffers = ReadonlyArray<ArrayBuffer | ArrayBufferView>;
export type Handler = (...args: any[]) => void;

/** Trait dictionary of a widget: trait name -> JSON value. */
export type Traits = Record<string, unknown>;

export interface AnyModel<T extends object = Traits> {
  get<K extends keyof T & string>(name: K): T[K];
  set<K extends keyof T & string>(name: K, value: T[K]): void;
  save_changes(): void;
  on(event: string, callback: Handler): void;
  off(event?: string | null, callback?: Handler | null): void;
  send(content: unknown, callbacks?: unknown, buffers?: Buffers): void;
  /** Jupyter only (nested widgets); other hosts do not provide it. */
  widget_manager?: unknown;
}
