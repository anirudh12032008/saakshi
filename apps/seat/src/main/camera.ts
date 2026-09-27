import { testMode } from './keystore.ts';
/** Test mode for automated checks: --no-camera, SAAKSHI_NO_CAMERA=1 or test mode keep the webcam off (no getUserMedia, no MediaPipe). */
export const cameraEnabled = (argv: readonly string[], env: Record<string, string | undefined>): boolean =>
  !argv.includes('--no-camera') && env.SAAKSHI_NO_CAMERA !== '1' && !testMode(argv, env);
