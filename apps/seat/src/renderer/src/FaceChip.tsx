import { useEffect, useRef, useState } from 'react';

/** A 160×120 JPEG grab of the current video frame, base64-encoded (no data: prefix); '' if the canvas is empty. */
function grabThumb(v: HTMLVideoElement): string {
  const c = document.createElement('canvas');
  c.width = 160; c.height = 120;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(v, 0, 0, 160, 120);
  return c.toDataURL('image/jpeg', 0.7).split(',')[1] ?? '';
}

/**
 * off = test mode (SAAKSHI_NO_CAMERA=1 / --no-camera): never touches getUserMedia or MediaPipe.
 * expected = faces the accommodation allows in frame (1 by default, 2 for a scribe seat). Every detection is sent
 * to the main process as a FaceSample (2/s); a thumbnail rides along only when the count does not match (plan §3.5).
 */
export function FaceChip({ label, unavailable, off, offLabel, expected }: { label: string; unavailable: string; off: boolean; offLabel: string; expected: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const [faces, setFaces] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (off) return;
    let timer: number | undefined, stream: MediaStream | undefined, detector: { close(): void } | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
        const fileset = await FilesetResolver.forVisionTasks(new URL('mediapipe/wasm', location.href).href);
        const d = await FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: new URL('mediapipe/blaze_face_short_range.tflite', location.href).href, delegate: 'CPU' },
          runningMode: 'VIDEO',
        });
        detector = d;
        timer = window.setInterval(() => {
          if (v.readyState < 2) return;
          const n = d.detectForVideo(v, performance.now()).detections.length;
          setFaces(n);
          window.saakshi.faceSample({ faces: n, at: Date.now(), thumb: n !== expected ? grabThumb(v) : undefined });
        }, 500);
      } catch { setFailed(true); }
    })();
    return () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); detector?.close(); };
  }, [off, expected]);

  if (off) return <span className="chip" aria-label={offLabel}><span aria-hidden="true">{offLabel}</span></span>;
  const text = failed ? unavailable : `${label}: ${faces ?? '—'}`;
  return (
    <span className={`chip${faces !== null && faces !== expected ? ' warn' : ''}`} aria-label={text}>
      <video ref={video} muted playsInline aria-hidden="true" />
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
