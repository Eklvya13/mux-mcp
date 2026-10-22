import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '../src/config.mjs';
let buildServer;
try { ({ buildServer } = await import('../src/tools.mjs')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const tokens = { MUX_TOKEN_ID:'read',MUX_TOKEN_SECRET:'secret',MUX_WRITE_TOKEN_ID:'write',MUX_WRITE_TOKEN_SECRET:'write-secret' };
const make = env => buildServer(getConfig({...tokens,...env})).registered;
const originalTools=['mux_list_video_views','mux_get_video_view','mux_list_dimensions','mux_dimension_values','mux_metric_overall','mux_metric_breakdown','mux_metric_timeseries','mux_list_assets','mux_get_asset'];

test('original nine names preserved and default tool discovery is GET-only', {skip:!buildServer && 'Install npm dependencies before running MCP SDK registration test'},()=>{
  const tools=make({});
  for (const original of originalTools) assert.ok(tools.includes(original),`Missing original: ${original}`);
  assert.equal(tools.length,32);
  assert.ok(tools.every(name=>!name.startsWith('mux_delete_')));
  assert.ok(!tools.includes('mux_update_asset_metadata'));
});

test('write and admin mutations are visible only with explicit permissions', {skip:!buildServer && 'Install npm dependencies before running MCP SDK registration test'},()=>{
  const write=make({MUX_ACCESS_MODE:'write'});
  assert.equal(write.length,36);
  assert.ok(write.includes('mux_create_subtitle_track'));
  assert.ok(!write.includes('mux_delete_asset'));
  const admin=make({MUX_ACCESS_MODE:'admin',MUX_ENABLE_ASSET_DELETE:'true',MUX_ENABLE_TRACK_DELETE:'true',MUX_ENABLE_PLAYBACK_ID_DELETE:'true'});
  assert.equal(admin.length,39);
  for (const name of ['mux_delete_asset','mux_delete_asset_track','mux_delete_asset_playback_id']) assert.ok(admin.includes(name));
});
