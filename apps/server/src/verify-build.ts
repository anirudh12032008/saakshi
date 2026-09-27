// Compile verify.html into ONE self-contained HTML string (inline script, no external src), so it opens offline from file://.
import { join } from 'node:path';

let cached: Promise<string> | undefined;

const build = () => Bun.build({ entrypoints: [join(import.meta.dir, 'verify.html')], target: 'browser', compile: true, minify: true, throw: false });

export function verifyHtml(): Promise<string> {
  return (cached ??= (async () => {
    // Bun 1.3.14: under `bun test <filter>` the first Bun.build in a process can miss files directly under fixtures/ (the test
    // scan leaves a partial directory cache). One retry sees the real directory; a genuine build error fails both times.
    let r = await build();
    if (!r.success) r = await build();
    if (!r.success || r.outputs.length !== 1) throw new Error(`verify.html build failed: ${r.logs.map(String).join('\n')}`);
    return r.outputs[0].text();
  })());
}
