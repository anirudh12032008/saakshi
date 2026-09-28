# Demo video: rehearsal + recording

Source of truth for act timing/caption text: `docs/plan.md` §6 (act table), mirrored in `tools/video.ts` (`ACTS`, `TIMING`).
Run `bun tools/video.ts` to render caption cards + assemble `docs/video/out/cut-7min.mp4` and `cut-3min.mp4` (+ sidecar `.srt`).
Drop recorded clips at `docs/video/clips/act{0..5}.mov` (or `.mp4`) before running — any act without a clip falls back to its
caption card alone, and the script prints which ones are missing.

## Per-act timing targets

| Act | 7-min cut | 3-min cut | Caption card |
|---|---|---|---|
| 0 Hook | 0:30 | 0:15 | "Recoverable, contained, provable" |
| 1 Before | 1:00 | 0:25 | "Risky seats caught before T0" |
| 2 T0 | 1:10 | 0:30 | "Exam started on time — even offline" |
| 3 During | 1:20 | 0:35 | "Data centre destroyed. 0 answers lost." |
| 4 After | 1:00 | 0:25 | "Altered answer caught, located and provable — evidence pack in one click" |
| 5 Decide | 1:00 | 0:25 | "Only the harmed are re-tested" |
| Close | 0:30 | — | (no card; talk over the numbers) |
| **Total** | **6:30** (+30s slack = 7:00) | **~2:35** (+slack = 3:00) | |

Each act's clip is trimmed to its target minus the 3s caption card that follows it (see `TIMING` in `tools/video.ts`);
edit that one table to reshape a cut without touching the rest of the script.

## Recording each fallback clip

Record screen only (no system audio needed — captions carry the story). Adjust `-i "1"` to your screen index
(`ffmpeg -f avfoundation -list_devices true -i ""` lists them). Stop with `q` or Ctrl-C once the act is done.

```sh
# Act 0 Hook — dashboard, 20k candidates / 100 centres / 3 data centres
ffmpeg -f avfoundation -framerate 30 -i "1" -t 35 docs/video/clips/act0.mov

# Act 1 Before — readiness board, AnyDesk/overlay-sim gate, seat turns green
ffmpeg -f avfoundation -framerate 30 -i "1" -t 65 docs/video/clips/act1.mov

# Act 2 T0 — degrade Centre 42, SYNC_LAG warning, custodian approvals, phoned offline code
ffmpeg -f avfoundation -framerate 30 -i "1" -t 75 docs/video/clips/act2.mov

# Act 3 During — ticks, kill Data Centre 2, P1 card, restart/rebuild, seat A->B handoff
ffmpeg -f avfoundation -framerate 30 -i "1" -t 85 docs/video/clips/act3.mov

# Act 4 After — submit slip, rogue edit, /verify catches it, evidence pack
ffmpeg -f avfoundation -framerate 30 -i "1" -t 65 docs/video/clips/act4.mov

# Act 5 Decide — radar rings planted centres, spared count, scorecard, notice in EN/HI/TA
ffmpeg -f avfoundation -framerate 30 -i "1" -t 65 docs/video/clips/act5.mov
```

After recording all six, run:

```sh
bun tools/video.ts
```

and check `docs/video/out/cut-7min.mp4` / `cut-3min.mp4`.

## Rehearsal log (3 timed rehearsals, per plan Stage 8)

| # | Date | 7-min cut actual | 3-min cut actual | Notes / fixes for next run |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
