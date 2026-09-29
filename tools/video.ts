// Stage 8 video tooling (plan §"Stage 8: Ship" / §6 Live demo / §7 Deliverables): builds the caption cards for every act,
// then — once the user has recorded clips — assembles the 7-min and 3-min demo cuts with captions.
//   1) Renders one dark-card PNG + a 3s video clip per act, text taken from the act table below (kept in sync with docs/plan.md §6).
//   2) Looks for docs/video/clips/act{0..5}.mov|mp4 (whichever exist). For each act: recorded clip (if present) + its caption
//      card; missing clips fall back to the card alone (printed to stderr so it's obvious what's still unrecorded).
//   3) Concatenates the per-cut act list, trimming each clip to the length in TIMING below, and writes a sidecar .srt
//      (one cue per act) alongside a burned-in-caption version.
//   Usage: bun tools/video.ts [--cuts 7,3]
//   Outputs: docs/video/out/cut-7min.mp4, cut-3min.mp4 (+ .srt each), docs/video/cards/act{N}.png
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const CLIPS_DIR = join(ROOT, 'docs/video/clips');
const CARDS_DIR = join(ROOT, 'docs/video/cards');
const OUT_DIR = join(ROOT, 'docs/video/out');
const CARD_SECONDS = 3;

// The act table (docs/plan.md §6). Caption = the "Caption card" column; label = the "Act" column.
export interface Act { id: number; label: string; caption: string }
export const ACTS: Act[] = [
  { id: 0, label: '0 Hook', caption: 'Recoverable, contained, provable' },
  { id: 1, label: '1 Before', caption: 'Risky seats caught before T0' },
  { id: 2, label: '2 T0', caption: 'Exam started on time — even offline' },
  { id: 3, label: '3 During', caption: 'Data centre destroyed. 0 answers lost.' },
  { id: 4, label: '4 After', caption: 'Altered answer caught, located and provable — evidence pack in one click' },
  { id: 5, label: '5 Decide', caption: 'Only the harmed are re-tested' },
];

// Trim length (seconds) per act per cut. Edit this table to reshape a cut; anything not listed uses the clip/card as-is.
// ponytail: a flat table, not a timeline editor — fine for 6 acts, revisit if acts grow past a dozen or need per-act crossfades.
const TIMING: Record<'7min' | '3min', Record<number, number>> = {
  '7min': { 0: 30, 1: 60, 2: 70, 3: 80, 4: 60, 5: 60 },
  '3min': { 0: 15, 1: 25, 2: 30, 3: 35, 4: 25, 5: 25 },
};

function ffmpeg(args: string[]) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
}

function findClip(id: number): string | null {
  for (const ext of ['mov', 'mp4']) {
    const p = join(CLIPS_DIR, `act${id}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

function renderCard(act: Act) {
  const png = join(CARDS_DIR, `act${act.id}.png`);
  const clip = join(CARDS_DIR, `act${act.id}.mp4`);
  const text = act.caption.replace(/:/g, '\\:').replace(/'/g, "\\'");
  const drawtext = `drawtext=text='${text}':fontcolor=white:fontsize=54:font=Helvetica:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=12`;
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x121212:s=1280x720', '-vf', drawtext, '-frames:v', '1', png]);
  ffmpeg(['-loop', '1', '-i', png, '-t', String(CARD_SECONDS), '-vf', 'format=yuv420p', clip]);
  return { png, clip };
}

function trimTo(src: string, seconds: number, out: string) {
  ffmpeg(['-i', src, '-t', String(seconds), '-vf', 'scale=1280:720,format=yuv420p', '-c:v', 'libx264', '-an', out]);
}

function srtTimestamp(s: number) {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000), rem = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(rem).padStart(3, '0')}`;
}

function buildCut(name: '7min' | '3min', cardClips: Record<number, string>) {
  const timing = TIMING[name];
  const workDir = join(OUT_DIR, `.work-${name}`);
  mkdirSync(workDir, { recursive: true });

  const segments: string[] = [];
  const cues: { start: number; end: number; text: string }[] = [];
  let t = 0;
  for (const act of ACTS) {
    const clip = findClip(act.id);
    const wantSeconds = timing[act.id] ?? CARD_SECONDS;
    if (!clip) {
      console.error(`[video] missing clip for act ${act.id} (${act.label}) — using caption card only`);
    } else {
      const seg = join(workDir, `seg-clip-${act.id}.mp4`);
      trimTo(clip, Math.max(1, wantSeconds - CARD_SECONDS), seg);
      segments.push(seg);
      cues.push({ start: t, end: t + Math.max(1, wantSeconds - CARD_SECONDS), text: act.label });
      t += Math.max(1, wantSeconds - CARD_SECONDS);
    }
    segments.push(cardClips[act.id]);
    cues.push({ start: t, end: t + CARD_SECONDS, text: act.caption });
    t += CARD_SECONDS;
  }

  const listFile = join(workDir, 'list.txt');
  writeFileSync(listFile, segments.map((s) => `file '${s}'`).join('\n'));
  const outMp4 = join(OUT_DIR, `cut-${name}.mp4`);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outMp4]);

  const srt = cues.map((c, i) => `${i + 1}\n${srtTimestamp(c.start)} --> ${srtTimestamp(c.end)}\n${c.text}\n`).join('\n');
  writeFileSync(join(OUT_DIR, `cut-${name}.srt`), srt);
  console.log(`[video] wrote ${outMp4} (${t.toFixed(1)}s) + sidecar .srt`);
}

// ---- Narrated cuts (docs/video/narration.md): playwright .webm clips + macOS `say` voiceover + burned-in captions ----
// Sections: Act 0 (docs/video/clips/act0.png), Acts 1-5 (act{N}-live.webm + act{N}-tour.webm, then the caption card), Close (close.png).
// Each act is retimed to its voiceover length (live part sped up, tour kept near 1x). Output: out/saakshi-demo-{7,3}min.mp4 (+ .srt).
const VOICE = 'Rishi', GAP = 0.35, TAIL = 0.6;
const dur = (f: string) => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

function parseNarration(): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  let sec = '', cut = '';
  for (const l of readFileSync(join(ROOT, 'docs/video/narration.md'), 'utf8').split('\n')) {
    if (l.startsWith('## ')) { sec = l.slice(3).split(' ')[0] === 'Close' ? '6' : l.match(/Act (\d)/)![1]; out[sec] = {}; }
    else if (l.startsWith('### ')) { cut = l.slice(4).trim(); out[sec][cut] = []; }
    else if (sec && cut && l.trim() && !l.startsWith('card:')) out[sec][cut].push(l.trim());
  }
  return out;
}

function buildNarrated(name: '7min' | '3min', lines: Record<string, Record<string, string[]>>, cardClips: Record<number, string>) {
  const work = join(OUT_DIR, `.work-n-${name}`);
  mkdirSync(work, { recursive: true });
  const sections: string[] = [];
  const cues: { start: number; end: number; text: string }[] = [];
  let total = 0;
  for (const id of [0, 1, 2, 3, 4, 5, 6]) {
    const sentences = lines[id][name];
    // 1) voiceover: one `say` per sentence, joined with short gaps; cue times fall out of the real durations.
    const parts: string[] = [], rel: { start: number; end: number; text: string }[] = [];
    let a = 0;
    sentences.forEach((text, i) => {
      const w = join(work, `s${id}-${i}.wav`);
      execFileSync('say', ['-v', VOICE, '-o', join(work, `s${id}-${i}.aiff`), text]);
      ffmpeg(['-i', join(work, `s${id}-${i}.aiff`), '-ar', '44100', '-ac', '1', w]);
      const d = dur(w);
      rel.push({ start: a, end: a + d, text });
      parts.push(w); a += d + GAP;
    });
    const T = a + TAIL;
    const gap = join(work, 'gap.wav');
    ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(GAP), gap]);
    const list = join(work, `a${id}.txt`);
    writeFileSync(list, parts.map((p) => `file '${p}'\nfile '${gap}'`).join('\n'));
    const audio = join(work, `a${id}.wav`);
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', audio]);
    // 2) visuals retimed to T.
    const vis = join(work, `v${id}.mp4`);
    const scale = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=25,format=yuv420p';
    if (id === 0 || id === 6) {
      ffmpeg(['-loop', '1', '-framerate', '25', '-i', join(CLIPS_DIR, id === 0 ? 'act0.png' : 'close.png'), '-t', String(T), '-vf', scale, '-c:v', 'libx264', vis]);
    } else {
      const live = join(CLIPS_DIR, `act${id}-live.webm`), tour = join(CLIPS_DIR, `act${id}-tour.webm`);
      const dl = dur(live), dt = dur(tour);
      if (dl < 5) ffmpeg(['-i', tour, '-vf', `setpts=${T / dt}*PTS,${scale}`, '-t', String(T), '-c:v', 'libx264', vis]);
      else {
        const Tt = T - dt >= 8 ? dt : T * 0.5, Tl = T - Tt;
        ffmpeg(['-i', live, '-i', tour, '-filter_complex',
          `[0:v]setpts=${Tl / dl}*PTS,${scale}[a];[1:v]setpts=${Tt / dt}*PTS,${scale}[b];[a][b]concat=n=2:v=1:a=0[v]`,
          '-map', '[v]', '-t', String(T), '-c:v', 'libx264', vis]);
      }
    }
    // 3) burn captions, then append the caption card (acts 1-5) and mux the voiceover.
    writeFileSync(join(work, `c${id}.srt`), rel.map((c, i) => `${i + 1}\n${srtTimestamp(c.start)} --> ${srtTimestamp(c.end)}\n${c.text}\n`).join('\n'));
    const capped = join(work, `vc${id}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `v${id}.mp4`, '-vf',
      `subtitles=c${id}.srt:force_style='FontName=Helvetica,FontSize=14,Outline=1,Shadow=0,MarginV=24,BorderStyle=3,OutlineColour=&HB0000000'`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', `vc${id}.mp4`], { cwd: work, stdio: 'inherit' });
    const sec = join(work, `sec${id}.mp4`);
    const card = id >= 1 && id <= 5;
    ffmpeg(card
      ? ['-i', capped, '-i', cardClips[id], '-i', audio, '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a]apad[a]', '-map', '[v]', '-map', '[a]', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', sec]
      : ['-i', capped, '-i', audio, '-filter_complex', '[1:a]apad[a]', '-map', '0:v', '-map', '[a]', '-shortest', '-c:v', 'copy', '-c:a', 'aac', sec]);
    sections.push(sec);
    for (const c of rel) cues.push({ start: total + c.start, end: total + c.end, text: c.text });
    total += T + (card ? CARD_SECONDS : 0);
  }
  writeFileSync(join(work, 'list.txt'), sections.map((s) => `file '${s}'`).join('\n'));
  const outMp4 = join(OUT_DIR, `saakshi-demo-${name}.mp4`);
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt'), '-c', 'copy', outMp4]);
  writeFileSync(join(OUT_DIR, `saakshi-demo-${name}.srt`), cues.map((c, i) => `${i + 1}\n${srtTimestamp(c.start)} --> ${srtTimestamp(c.end)}\n${c.text}\n`).join('\n'));
  console.log(`[video] wrote ${outMp4} (${dur(outMp4).toFixed(1)}s)`);
}

function main() {
  const arg = process.argv.find((a) => a.startsWith('--cuts='));
  const cuts = (arg ? arg.split('=')[1] : '7,3').split(',').map((s) => (s.trim() === '7' ? '7min' : '3min')) as ('7min' | '3min')[];

  mkdirSync(CARDS_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const cardClips: Record<number, string> = {};
  for (const act of ACTS) {
    const { clip } = renderCard(act);
    cardClips[act.id] = clip;
    console.log(`[video] card for act ${act.id}: ${clip}`);
  }

  if (existsSync(join(ROOT, 'docs/video/narration.md')) && existsSync(join(CLIPS_DIR, 'act1-live.webm'))) {
    const n = parseNarration();
    for (const cut of cuts) buildNarrated(cut, n, cardClips);
  } else for (const cut of cuts) buildCut(cut, cardClips);
}

main();
