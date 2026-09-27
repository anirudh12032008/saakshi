// Streaming reader for cohort JSONL (fixtures/schemas/v1.json rows): memory stays flat even for G1's 2M-row file.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export interface CohortRow {
  cand: string; centre: string; shift: string; form: 'F1' | 'F2'; lang: string; pwd: 0 | 1; item: string;
  state: 'NV' | 'NA' | 'A' | 'MR' | 'AMR'; answer: string; dwellMs: number; visits: number; changes: number; tFirstMs: number;
}

export async function* readCohort(path: string): AsyncGenerator<CohortRow> {
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) if (line.trim()) yield JSON.parse(line) as CohortRow;
}
