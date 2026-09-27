import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTEGRITY_DEFAULT } from '@saakshi/core/integrity';
import { baseName, matchRules, parseIoregPlatform, parseNetstat, parsePs, parseRegBios, parseTasklistCsv, probe, run, vmMacs } from '../src/main/probe-parse.ts';

test('parses tasklist /FO CSV /NH output', () => {
  const csv = '"System Idle Process","0","Services","0","8 K"\r\n"AnyDesk.exe","4242","Console","1","12,345 K"\r\n';
  assert.deepEqual(parseTasklistCsv(csv), [{ name: 'System Idle Process', pid: 0 }, { name: 'AnyDesk.exe', pid: 4242 }]);
});

test('parses ps -axo pid=,comm= output (paths with spaces)', () => {
  const out = '    1 /sbin/launchd\n  812 /System/Library/CoreServices/RemoteManagement/screensharingd.bundle/Contents/MacOS/screensharingd\n 9001 /Applications/OBS.app/Contents/MacOS/OBS Studio\n';
  assert.deepEqual(parsePs(out).map((p) => p.pid), [1, 812, 9001]);
  assert.equal(parsePs(out)[2].name, '/Applications/OBS.app/Contents/MacOS/OBS Studio');
});

test('rules match by lowercase basename without .exe, and by macOS bundle ID', () => {
  const hits = matchRules([{ name: 'C:\\x\\AnyDesk.exe' }, { name: '/usr/bin/zsh' }, { name: '/Applications/Foo.app/Contents/MacOS/Foo', bundleId: 'com.teamviewer.TeamViewer' },
    { name: 'obs64.exe' }], INTEGRITY_DEFAULT.blocklist);
  assert.deepEqual(hits, [{ rule: 'AnyDesk', name: 'AnyDesk' }, { rule: 'TeamViewer', name: 'Foo' }, { rule: 'OBS Studio', name: 'obs64' }]);
  assert.equal(baseName('/Applications/OBS.app/Contents/MacOS/OBS Studio'), 'OBS Studio');
});

test('netstat: ESTABLISHED remotes only, both OSes, IPv6, deduplicated', () => {
  const mac = 'Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)\n'
    + 'tcp4       0      0  192.168.1.5.52000      192.168.1.10.7070      ESTABLISHED\n'
    + 'tcp4       0      0  192.168.1.5.52001      142.250.1.1.443        ESTABLISHED\n'
    + 'tcp4       0      0  *.7070                 *.*                    LISTEN\n'
    + 'tcp6       0      0  fe80::1%lo0.52002      fe80::1%lo0.7070       ESTABLISHED\n'
    + 'tcp4       0      0  192.168.1.5.52003      192.168.1.10.7070      ESTABLISHED\n';
  assert.deepEqual(parseNetstat(mac, 'darwin'), ['192.168.1.10:7070', '142.250.1.1:443', 'fe80::1%lo0:7070']);
  const win = '  Proto  Local Address          Foreign Address        State           PID\r\n'
    + '  TCP    10.1.0.4:49712         10.1.0.9:7070          ESTABLISHED     4242\r\n'
    + '  TCP    [::1]:49713            [::1]:7070             ESTABLISHED     4242\r\n'
    + '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       900\r\n';
  assert.deepEqual(parseNetstat(win, 'win32'), ['10.1.0.9:7070', '[::1]:7070']);
});

test('BIOS and ioreg strings; VM MAC prefixes skip Hyper-V', () => {
  const reg = '\r\nHKEY_LOCAL_MACHINE\\HARDWARE\\DESCRIPTION\\System\\BIOS\r\n    BIOSVendor    REG_SZ    VMware, Inc.\r\n    SystemManufacturer    REG_SZ    VMware, Inc.\r\n    SystemProductName    REG_SZ    VMware7,1\r\n';
  assert.equal(parseRegBios(reg), 'VMware, Inc. | VMware7,1 | VMware, Inc.');
  const io = '+-o J316sAP  <class IOPlatformExpertDevice>\n    {\n      "manufacturer" = <"Apple Inc.">\n      "model" = <"VirtualMac2,1">\n    }\n';
  assert.equal(parseIoregPlatform(io), 'Apple Inc. | VirtualMac2,1');
  assert.deepEqual(vmMacs(['00:15:5D:01:02:03', '08:00:27:aa:bb:cc', '00:00:00:00:00:00', 'a4:83:e7:00:00:01'], INTEGRITY_DEFAULT.vmMacPrefixes), ['08:00:27:aa:bb:cc']);
});

test('a hanging probe returns unknown after its timeout', async () => {
  const t0 = Date.now();
  const r = await probe(() => run(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], 200));
  assert.equal(r.status, 'unknown');
  assert.ok(Date.now() - t0 < 3000);
});
