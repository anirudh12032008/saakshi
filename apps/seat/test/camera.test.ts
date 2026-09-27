import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraEnabled } from '../src/main/camera.ts';

test('the camera is on by default and off with --no-camera or SAAKSHI_NO_CAMERA=1', () => {
  assert.equal(cameraEnabled(['electron', '.'], {}), true);
  assert.equal(cameraEnabled(['electron', '.', '--no-camera'], {}), false);
  assert.equal(cameraEnabled(['electron', '.'], { SAAKSHI_NO_CAMERA: '1' }), false);
  assert.equal(cameraEnabled(['electron', '.'], { SAAKSHI_NO_CAMERA: '0' }), true);
});

test('test mode also turns the camera off', () => {
  assert.equal(cameraEnabled(['electron', '.', '--test-mode'], {}), false);
  assert.equal(cameraEnabled(['electron', '.'], { SAAKSHI_TEST_MODE: '1' }), false);
});
