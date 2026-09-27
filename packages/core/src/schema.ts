/** Field specs for the frozen v1 cohort/export schemas (fixtures/schemas/v1.json). */
export type FieldSpec = 'string' | 'int' | 'hex64' | (string | number)[];

const ok = (v: unknown, s: FieldSpec): boolean =>
  s === 'string' ? typeof v === 'string'
  : s === 'int' ? Number.isSafeInteger(v)
  : s === 'hex64' ? typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
  : s.includes(v as string | number);

export function validateRow(row: Record<string, unknown>, spec: Record<string, FieldSpec>): string[] {
  const errs: string[] = [];
  for (const k of Object.keys(row)) if (!(k in spec)) errs.push(`unexpected field ${k}`);
  for (const [k, s] of Object.entries(spec)) {
    if (!(k in row)) errs.push(`missing ${k}`);
    else if (!ok(row[k], s)) errs.push(`bad ${k}: ${JSON.stringify(row[k])}`);
  }
  return errs;
}
