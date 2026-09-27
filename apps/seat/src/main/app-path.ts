import { join, normalize, sep } from 'node:path';

/** Map an app:// URL path to a file under root, or null if it would escape root or is malformed. */
export function resolveAppPath(root: string, urlPath: string): string | null {
  let rel: string;
  try { rel = decodeURIComponent(urlPath); } catch { return null; }
  if (rel.includes('\0')) return null;
  const base = normalize(root);
  const full = normalize(join(base, rel === '/' ? 'index.html' : rel));
  return full.startsWith(base + sep) ? full : null;
}
