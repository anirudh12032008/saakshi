export type Canon = string | number | Canon[];

function check(v: unknown): void {
  if (typeof v === 'string') return;
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v) || Object.is(v, -0)) throw new Error(`canon: not a safe integer: ${v}`);
    return;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) throw new Error('canon: sparse array');
      check(v[i]);
    }
    return;
  }
  throw new Error(`canon: disallowed type ${v === null ? 'null' : typeof v}`);
}

/** Canonical encoding: a type-tagged array of strings, safe integers and nested arrays, as compact JSON. */
export function canon(v: Canon[]): string {
  if (!Array.isArray(v) || typeof v[0] !== 'string') throw new Error('canon: top level must be a type-tagged array');
  check(v);
  return JSON.stringify(v);
}

/** Parse, and require the text to be exactly the canonical encoding of what it parses to. */
export function parseCanon(text: string): Canon[] {
  const v = JSON.parse(text) as Canon[];
  if (canon(v) !== text) throw new Error('canon: not canonical');
  return v;
}
