import { useEffect, useRef, useState } from 'react';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

declare global { interface Window { saakshi: { safeStorageCheck(): Promise<string> } } }

export function App() {
  const video = useRef<HTMLVideoElement>(null);
  const [faces, setFaces] = useState<number | null>(null);
  const [status, setStatus] = useState('starting camera…');
  const [safe, setSafe] = useState('…');

  useEffect(() => { window.saakshi.safeStorageCheck().then(setSafe, (e) => setSafe(String(e))); }, []);

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
        setStatus('detecting at 2 fps');
        timer = window.setInterval(() => {
          if (v.readyState >= 2) setFaces(detector!.detectForVideo(v, performance.now()).detections.length);
        }, 500);
      } catch (e) {
        setStatus(`error: ${(e as Error).message}`);
      }
    })();
    return () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); detector?.close(); };
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>Saakshi seat — feasibility spike</h1>
      <video ref={video} muted playsInline width={320} height={240} style={{ background: '#111' }} />
      <p style={{ fontSize: 32 }}>Faces: {faces ?? '—'}</p>
      <p>Status: {status}</p>
      <p>safeStorage: {safe}</p>
      <p>Origin: {location.origin}</p>
    </main>
  );
}
