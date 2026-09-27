// macOS twin of probes-win.ts (plan §3.4): other apps' on-screen windows whose sharing state is None (kCGWindowSharingState == 0) are
// excluded from screen capture. Honest limit: on macOS 15+ ScreenCaptureKit may ignore sharingType and CoreGraphics may report 1 for
// every window, so a window reported here is a strong signal, but its absence proves nothing (docs/threat-model.md).
import koffi from 'koffi';

const CF = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
const CG = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
const CGWindowListCopyWindowInfo = CG.func('void *CGWindowListCopyWindowInfo(uint32_t option, uint32_t relativeToWindow)');
const CFArrayGetCount = CF.func('long CFArrayGetCount(void *arr)');
const CFArrayGetValueAtIndex = CF.func('void *CFArrayGetValueAtIndex(void *arr, long i)');
const CFDictionaryGetValue = CF.func('void *CFDictionaryGetValue(void *dict, void *key)');
const CFNumberGetValue = CF.func('bool CFNumberGetValue(void *num, int type, _Out_ int64_t *out)');
const CFStringCreateWithCString = CF.func('void *CFStringCreateWithCString(void *alloc, const char *s, uint32_t enc)');
const CFStringGetCString = CF.func('bool CFStringGetCString(void *s, _Out_ uint8_t *buf, long size, uint32_t enc)');
const CFRelease = CF.func('void CFRelease(void *x)');
const UTF8 = 0x08000100, SInt64 = 4, OnScreenOnly = 1 << 0, ExcludeDesktop = 1 << 4;
const key = (s: string): unknown => CFStringCreateWithCString(null, s, UTF8);
// ponytail: never released (4 strings, process lifetime)
const K = { sharing: key('kCGWindowSharingState'), pid: key('kCGWindowOwnerPID'), owner: key('kCGWindowOwnerName'), layer: key('kCGWindowLayer') };

function num(d: unknown, k: unknown): number | undefined {
  const v = CFDictionaryGetValue(d, k); if (!v) return undefined;
  const out = [0n]; return CFNumberGetValue(v, SInt64, out) ? Number(out[0]) : undefined;
}
function str(d: unknown, k: unknown): string {
  const v = CFDictionaryGetValue(d, k); if (!v) return '';
  const buf = Buffer.alloc(512); return CFStringGetCString(v, buf, buf.length, UTF8) ? buf.toString('utf8').replace(/\0.*$/s, '') : '';
}

/** On-screen app-level (layer 0–19) windows of other processes whose sharing state is None (excluded from capture). */
export function captureExcludedWindowsMac(): { visibleWindows: number; excluded: { pid: number; owner: string; sharing: number }[] } {
  const arr = CGWindowListCopyWindowInfo(OnScreenOnly | ExcludeDesktop, 0);
  if (!arr) throw new Error('CGWindowListCopyWindowInfo returned NULL');
  try {
    const n = Number(CFArrayGetCount(arr)), excluded: { pid: number; owner: string; sharing: number }[] = [];
    let visibleWindows = 0;
    for (let i = 0; i < n; i++) {
      const d = CFArrayGetValueAtIndex(arr, i);
      const layer = num(d, K.layer) ?? 0;
      if (layer < 0 || layer >= 20) continue;                      // app levels (normal 0, floating 3, modal 8); Dock (20), menu bar, status items sit higher
      visibleWindows++;
      const pid = num(d, K.pid) ?? 0, sharing = num(d, K.sharing);
      if (sharing === 0 && pid !== process.pid) excluded.push({ pid, owner: str(d, K.owner), sharing });
    }
    return { visibleWindows, excluded };
  } finally { CFRelease(arr); }
}
