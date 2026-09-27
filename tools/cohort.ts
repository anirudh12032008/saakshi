// Streaming reader for cohort JSONL (fixtures/schemas/v1.json rows): memory stays flat even for G1's 2M-row file.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type { CohortRow } from '../packages/core/src/analytics.ts';
export type { CohortRow } from '../packages/core/src/analytics.ts';

export async function* readCohort(path: string): AsyncGenerator<CohortRow> {
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) if (line.trim()) yield JSON.parse(line) as CohortRow;
}
