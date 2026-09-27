/** Test mode for automated checks: SAAKSHI_NO_CAMERA=1 or --no-camera keeps the webcam off (no getUserMedia, no MediaPipe). */
export const cameraEnabled = (argv: readonly string[], env: Record<string, string | undefined>): boolean =>
  !argv.includes('--no-camera') && env.SAAKSHI_NO_CAMERA !== '1';
