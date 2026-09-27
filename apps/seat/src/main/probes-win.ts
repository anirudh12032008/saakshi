import koffi from 'koffi';

const user32 = koffi.load('user32.dll');
const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr_t lParam)');
const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hwnd)');
const GetWindowDisplayAffinity = user32.func('bool __stdcall GetWindowDisplayAffinity(void *hwnd, _Out_ uint32_t *affinity)');
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)');
const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int nIndex)');
const SM_REMOTESESSION = 0x1000;

export const remoteSession = (): boolean => GetSystemMetrics(SM_REMOTESESSION) !== 0;

/** Visible top-level windows of other processes whose display affinity excludes them from capture. */
export function captureExcludedWindows(): { visibleWindows: number; excluded: { pid: number; affinity: number }[] } {
  let visibleWindows = 0;
  const excluded: { pid: number; affinity: number }[] = [];
  EnumWindows((hwnd: unknown) => {
    if (!IsWindowVisible(hwnd)) return true;
    visibleWindows++;
    const aff = [0];
    if (GetWindowDisplayAffinity(hwnd, aff) && aff[0] !== 0) {
      const pid = [0];
      GetWindowThreadProcessId(hwnd, pid);
      if (pid[0] !== process.pid) excluded.push({ pid: pid[0], affinity: aff[0] });
    }
    return true;
  }, 0);
  return { visibleWindows, excluded };
}
