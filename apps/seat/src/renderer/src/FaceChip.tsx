import { useEffect, useRef, useState } from 'react';

/** off = test mode (SAAKSHI_NO_CAMERA=1 / --no-camera): never touches getUserMedia or MediaPipe. */
export function FaceChip({ label, unavailable, off, offLabel }: { label: string; unavailable: string; off: boolean; offLabel: string }) {
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
        timer = window.setInterval(() => { if (v.readyState >= 2) setFaces(d.detectForVideo(v, performance.now()).detections.length); }, 500);
      } catch { setFailed(true); }
    })();
    return () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); detector?.close(); };
  }, [off]);

  if (off) return <span className="chip" aria-label={offLabel}><span aria-hidden="true">{offLabel}</span></span>;
  const text = failed ? unavailable : `${label}: ${faces ?? '—'}`;
  return (
    <span className={`chip${faces !== null && faces !== 1 ? ' warn' : ''}`} aria-label={text}>
      <video ref={video} muted playsInline aria-hidden="true" />
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
