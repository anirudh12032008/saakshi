# Windows seat bring-up checklist

For seat A (the physical Windows laptop) when it arrives. Ordered so each step can be ticked off fast; commands are exact, run from the repo root unless noted. Source of truth for build/test steps: `.github/workflows/windows.yml` (CI does this on `windows-latest` today; this checklist repeats it by hand on real hardware).

## 0. Prerequisites (once)

- [ ] Node 25, pnpm, Bun installed (same versions CI uses: `actions/setup-node@v5` with `node-version: 25`, `oven-sh/setup-bun@v2`).
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm -r test` — must be green before packaging.

## 1. Build and install the packaged seat

CI builds it with `pnpm --filter @saakshi/seat pack:win` (unpacked, for the self-tests) and `pnpm --filter @saakshi/seat dist:win` (NSIS installer, only on tag/dispatch runs). On the laptop, build the installer directly:

```
pnpm --filter @saakshi/seat dist:win
```

This produces `apps/seat/release/*.exe` (NSIS setup). Run the installer, or for a quick unpacked run instead:

```
pnpm --filter @saakshi/seat pack:win
```

→ `apps\seat\release\win-unpacked\Saakshi.exe`

## 2. SmartScreen clearing

The exe is unsigned (no code-signing cert in this project). Expect "Windows protected your PC":
- [ ] Click **More info** → **Run anyway**.
- If SmartScreen blocks the download itself (browser-level), right-click the downloaded file → **Properties** → check **Unblock** → **OK**, then run the installer.
- This has to be done once per machine per binary hash; a new build after code changes triggers it again.

## 3. Camera privacy toggle

- [ ] Settings → Privacy & security → Camera → **Camera access** on.
- [ ] Under "Let apps access your camera", turn **on** for Saakshi (or "Desktop apps" if Electron isn't listed individually).
- Expected: `FaceChip` shows a live face count instead of a permission error. If face flags never fire, this is the first thing to check.

## 4. Recording / kiosk keys — expected results

The exam build sets `kiosk: true, fullscreen: true, alwaysOnTop: true, contentProtection: true` on Windows (`apps/seat/src/main/hardening.ts` → `windowMode`). Verify each is actually held before trusting the demo:

| Key | Expected result |
|---|---|
| Alt-Tab | Should not switch away from Saakshi (kiosk mode traps focus). If it does, the OS build/policy is overriding kiosk — flag it. |
| Win key | Should not open the Start menu while the seat window is focused and kiosk-active; if it does, note it as a known Windows kiosk limitation (Electron kiosk mode does not intercept the Windows key on all builds — this is a residual risk, not a bug in our code). |
| Ctrl+Alt+Del | Always reaches the OS (this is by design — Windows reserves it below any app, including ours). Expected: it works and can switch away; this is **not** a gap our gate claims to close. Document it as an honest limit, don't try to "fix" it. |
| `--inspect` / `--remote-debugging-port` | Refused: process exits with code 3 and stderr `Saakshi refused to start: --inspect is not allowed in an exam build` (see `launchRefusal` in `hardening.ts`). |
| `ELECTRON_RUN_AS_NODE=1` | Ignored — the RunAsNode fuse is off in the release build. |

## 5. Network profile: set to Private

- [ ] Settings → Network & internet → the seat's Ethernet/Wi-Fi connection → **Network profile type: Private**.
- Needed so Windows Firewall's private-profile rules apply (not the more restrictive Public defaults) once the LAN is confirmed trusted (our own router, §7).

## 6. macOS firewall: allow `bun`

On the Mac (control/relay/cells), the first time `bun` binds a listening port, macOS's Application Firewall will prompt:
- [ ] System Settings → Network → Firewall → Options → confirm `bun` (or the specific binary path under `.bun`) is set to **Allow incoming connections**.
- If the prompt was dismissed/denied earlier: remove it from the list and re-trigger by starting the relay again, or add it manually via **+** and pick the `bun` binary.

## 7. Router / Ethernet setup

- [ ] Bring the dedicated router and Ethernet cable (plan §6: "We bring our own router and an Ethernet cable" — don't rely on venue Wi-Fi).
- [ ] Connect the Mac (running control/cells/witness/demo relay) and the Windows laptop (seat A) to the same router, wired where possible.
- [ ] Confirm both machines get IPs on the same subnet (`ipconfig` on Windows / `ifconfig` or System Settings → Network on Mac) and can ping each other.
- [ ] Note the Mac's LAN IP — the seat's `--relay` flag needs it.

## 8. Connect seat A to the Mac relay

Launch the seat with the relay URL explicit:

```
Saakshi.exe --relay=http://<mac-lan-ip>:7070 --seat=CEN042-S01 --cand=C0001
```

**Electron gotcha — always use `--relay=URL`, never `--relay URL` (space-separated):** on Windows, Electron refuses to start (exits -1, before any app code runs) when a URL-looking argument is followed by more CLI switches, because it tries to parse the URL itself. Always pass the value with `=` so it's a single argv token (`argValue` in `hardening.ts` handles both forms, but the space form is what crashes Electron's own arg parsing before our code ever sees it). Default relay if the flag is omitted: `http://127.0.0.1:7070` (`SAAKSHI_RELAY` env var also works).

Expected: the seat's status line shows the relay reachable (skew-check `HEAD /v1/status` succeeds); a green tick appears once an answer round-trips.

## 9. Run the gate self-test

Confirms the blocklist/capture-exclusion/VM probes work on real hardware before trusting the live demo gate:

```
Saakshi.exe --gate-selftest --expect anydesk,overlay-sim --out gate.json
type gate.json
```

Expected (nothing running): exit code non-zero, `missing: ["anydesk","overlay-sim"]`, `verdict` likely `block` on `vm` alone if the laptop itself scores ≥2 VM signals (real hardware should normally score 0 here — if it scores ≥2, that's worth noting since CI's own VM runner does).

To prove it blocks for real, start a renamed copy of something as `AnyDesk.exe` and run `Saakshi.exe --overlay-sim` as `overlay-sim.exe`, then re-run the self-test and expect `verdict: block`, `missing: []`, both named in `findings`.

Also run the plain probe self-test:

```
Saakshi.exe --probe-selftest --out probe.json
```

Expected: `ok: true`, non-empty `probes.processes`.

## 10. Windows column of the detection matrix — fill in on real hardware

This table mirrors the one in `docs/threat-model.md` §"Detection matrix". CI only proves name-matching on its own VM runner; every row here needs a tick from the actual Windows laptop, side by side with a genuine tool (not a renamed stand-in) where noted.

| Check | Genuine tool / condition | Expected | Actual result | Notes |
|---|---|---|---|---|
| Blocklisted process | Real AnyDesk installed and running | Blocked, named | | |
| Blocklisted process | Real TeamViewer | Blocked, named | | |
| Capture-excluded window | Real Cluely or another WDA_EXCLUDEFROMCAPTURE overlay | Blocked, named | | |
| Remote session | Real incoming RDP session | `SM_REMOTESESSION` true, blocked | | |
| Remote session | RemoteFX-based RDP | Known gap — likely **not** detected | | confirm residual risk in threat-model |
| VM | This laptop is real hardware | Score 0, no VM block | | |
| Second display | External monitor attached | Flagged/reviewed per policy | | not yet wired per threat-model — confirm |
| Egress allowlist | Non-allowlisted outbound connection | Review-only flag, not blocking | | |
| Kiosk / Alt-Tab / Win / Ctrl+Alt+Del | See §4 above | See §4 | | |
| NVDA running | Screen reader active | Allowed, `info` finding | | |
| Scribe seat, 2 faces | Two people at one seat | No flag (expected 2) | | |
| Camera / face count | Real camera, real face | Live count works | | first Stage-7 item to prove |

Fill in "Actual result" from the real laptop and copy the finished table into `docs/threat-model.md`'s detection matrix once done — don't edit that file by hand until then (it's being edited elsewhere in this task).
