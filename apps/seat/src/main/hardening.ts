// Electron hardening decisions (plan §3.4), pure. The fuses (electron-builder.yml) stop RunAsNode, NODE_OPTIONS and --inspect in the
// release build; this refuses the switches Chromium itself honours. The e2e build (SAAKSHI_E2E=1, fuses off) exists for Playwright,
// which needs them. Claim: deterrence and detection, not lockdown.
declare const __SAAKSHI_E2E__: boolean | undefined;
export const E2E: boolean = typeof __SAAKSHI_E2E__ !== 'undefined' && __SAAKSHI_E2E__ === true;
const DEBUG = /^--(remote-debugging-(port|pipe|address)|inspect(-brk|-port)?)(=|$)/;

export function launchRefusal(argv: readonly string[], e2e: boolean): string | undefined {
  if (e2e) return undefined;
  const hit = argv.find((a) => DEBUG.test(a));
  return hit ? `Saakshi refused to start: ${hit.split('=')[0]} is not allowed in an exam build` : undefined;
}

export function windowMode(o: { test: boolean; e2e: boolean; platform: string }) {
  const exam = !o.test && !o.e2e;
  // setContentProtection: WDA_EXCLUDEFROMCAPTURE on Windows; on macOS 15+ capture tools may ignore it, so we claim nothing there.
  return { kiosk: exam, fullscreen: exam, alwaysOnTop: exam, contentProtection: exam && o.platform === 'win32', devtools: o.e2e };
}

/** `--flag value` or `--flag=value`. On Windows, Electron refuses to start (exit -1, before any app code) when a URL-looking
 *  argument is followed by more switches, so a URL must be passed as `--relay=http://…`. */
export function argValue(argv: readonly string[], flag: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(flag + '='));
  if (eq) return eq.slice(flag.length + 1);
  const i = argv.indexOf(flag);
  return i > 0 ? argv[i + 1] : undefined;
}
