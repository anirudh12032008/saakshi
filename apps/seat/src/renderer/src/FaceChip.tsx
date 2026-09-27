import { useEffect, useRef, useState } from 'react';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

export function FaceChip({ label, unavailable }: { label: string; unavailable: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [faces, setFaces] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let timer: number | undefined, stream: MediaStream | undefined, detector: FaceDetector | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const fileset = await FilesetResolver.forVisionTasks(new URL('mediapipe/wasm', location.href).href);
        detector = await FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: new URL('mediapipe/blaze_face_short_range.tflite', location.href).href, delegate: 'CPU' },
          runningMode: 'VIDEO',
        });
        timer = window.setInterval(() => { if (v.readyState >= 2) setFaces(detector!.detectForVideo(v, performance.now()).detections.length); }, 500);
      } catch { setFailed(true); }
    })();
    return () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); detector?.close(); };
  }, []);

  const text = failed ? unavailable : `${label}: ${faces ?? '—'}`;
  return (
    <span className={`chip${faces !== null && faces !== 1 ? ' warn' : ''}`} aria-label={text}>
      <video ref={video} muted playsInline aria-hidden="true" />
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
