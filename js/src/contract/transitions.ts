// State transitions declared in the schemas (x-awi-transitions): a table of
// [state, event, next state]; any other (state, event) pair keeps the state.
// The Python tables are checked against the schemas (tests/test_contract.py).

export type Transitions = ReadonlyArray<readonly [string, string, string]>;

export function applyTransition(table: Transitions | undefined, state: string, event: string): string {
  const row = table?.find(([from, on]) => from === state && on === event);
  return row ? row[2] : state;
}
