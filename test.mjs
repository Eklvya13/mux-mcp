import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedPath } from './server-paths.mjs';
test('GET endpoint allowlist', () => {
  for (const x of ['/data/v1/video-views','/data/v1/video-views/abc','/data/v1/dimensions','/data/v1/metrics/views/overall','/video/v1/assets/abc']) assert.ok(allowedPath(x),x);
  for (const x of ['/video/v1/assets/abc/delete','/video/v1/uploads','/data/v1/annotations','https://example.com','/data/v1/video-views/../annotations']) assert.ok(!allowedPath(x),x);
});
