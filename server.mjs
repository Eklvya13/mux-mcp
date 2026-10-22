import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

// SECURITY: explicit fixed-origin, fixed-path, GET-only allowlist. No generic HTTP tool.
const ORIGIN = 'https://api.mux.com';
const tokenId = process.env.MUX_TOKEN_ID;
const tokenSecret = process.env.MUX_TOKEN_SECRET;
if (!tokenId || !tokenSecret) {
  console.error('Missing MUX_TOKEN_ID or MUX_TOKEN_SECRET in the MCP process environment.');
  process.exit(1);
}

import { allowedPath } from './server-paths.mjs';

async function muxGet(path, params = {}) {
  if (!allowedPath(path)) throw new Error('Blocked: endpoint not on GET-only allowlist');
  const url = new URL(path, ORIGIN);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) for (const val of value) url.searchParams.append(key, String(val));
    else url.searchParams.set(key, String(value));
  }
  const auth = Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Mux API HTTP ${response.status}: ${text.slice(0, 400)}`);
    return JSON.parse(text);
  } finally { clearTimeout(timeout); }
}

const timeframe = z.object({
  days: z.number().int().min(1).max(90).default(7).describe('Relative timeframe in days, overridden by start_epoch/end_epoch'),
  start_epoch: z.number().int().positive().optional().describe('UTC Unix seconds, beginning of range'),
  end_epoch: z.number().int().positive().optional().describe('UTC Unix seconds, end of range')
});
const paging = { limit: z.number().int().min(1).max(100).default(25), page: z.number().int().min(1).max(10000).default(1) };
const id = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/);
function tf(args) {
  if ((args.start_epoch === undefined) !== (args.end_epoch === undefined)) throw new Error('Supply both start_epoch and end_epoch');
  if (args.start_epoch !== undefined) {
    if (args.start_epoch >= args.end_epoch) throw new Error('start_epoch must precede end_epoch');
    return [String(args.start_epoch), String(args.end_epoch)];
  }
  return [`${args.days}:days`];
}
function filters({viewer_user_id, asset_id, video_id, playback_id, video_title, additional_filter}) {
  const results = [];
  for (const [key,val] of Object.entries({viewer_user_id,asset_id,video_id,playback_id,video_title})) {
    if (val !== undefined && val !== '') results.push(`${key}:${val}`);
  }
  if (additional_filter) results.push(additional_filter);
  return results;
}
const cleanFilter = z.string().min(1).max(256).regex(/^!?[a-z][a-z_0-9]*:[^\r\n]+$/).optional();
const viewArgs = timeframe.extend({
  ...paging,
  viewer_user_id: z.string().max(256).optional().describe('App-defined viewer_user_id (not Mux internal viewer_id)'),
  asset_id: z.string().max(256).optional(),
  video_id: z.string().max(256).optional(),
  playback_id: z.string().max(256).optional(),
  video_title: z.string().max(256).optional(),
  additional_filter: cleanFilter.describe('Optional Mux filters[] expression, e.g. country:US'),
  viewer_id: z.string().max(256).optional().describe('Mux viewer ID (different from viewer_user_id)'),
  order_direction: z.enum(['asc','desc']).default('desc')
});
const server = new McpServer({ name: 'mux-data-readonly', version: '1.0.0' });
function expose(name, description, inputSchema, handler) {
  server.registerTool(name, { description: `READ ONLY. ${description}`, inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, async (a) => {
    try { const result = await handler(a); return { content: [{ type: 'text', text: JSON.stringify(result) }] }; }
    catch (e) { return { isError:true, content:[{type:'text', text:String(e.message ?? e)}] }; }
  });
}
expose('mux_list_video_views','List Mux viewing records with pagination and optional student, asset, video and date filters. Timeframe uses view_end.',viewArgs, a => muxGet('/data/v1/video-views',{
  'timeframe[]':tf(a), 'filters[]':filters(a), viewer_id:a.viewer_id, limit:a.limit, page:a.page, order_direction:a.order_direction
}));
expose('mux_get_video_view','Get full record for one video view, including metadata and playback events.',z.object({view_id:id}), a=>muxGet(`/data/v1/video-views/${a.view_id}`));
expose('mux_list_dimensions','Discover available Mux Data dimensions.',z.object({}),()=>muxGet('/data/v1/dimensions'));
expose('mux_dimension_values','List top values and their counts for one dimension.',timeframe.extend({dimension:id,...paging}),a=>muxGet(`/data/v1/dimensions/${a.dimension}`,{'timeframe[]':tf(a),limit:a.limit,page:a.page}));
const metric = z.enum(['views','unique_viewers','playing_time','viewer_experience_score','rebuffer_percentage','video_startup_time','playback_failure_percentage','video_quality_score','rebuffer_count','rebuffer_duration','view_dropped_percentage']);
const metricArgs = timeframe.extend({metric, viewer_user_id:z.string().max(256).optional(), asset_id:z.string().max(256).optional(), video_id:z.string().max(256).optional(), playback_id:z.string().max(256).optional(), video_title:z.string().max(256).optional()});
expose('mux_metric_overall','Get Mux aggregated metric and associated total watch/playing time.',metricArgs,a=>muxGet(`/data/v1/metrics/${a.metric}/overall`,{'timeframe[]':tf(a),'filters[]':filters(a)}));
expose('mux_metric_timeseries','Retrieve metric trend by hour or day.',metricArgs.extend({group_by:z.enum(['minute','ten_minutes','hour','day']).default('day')}),a=>muxGet(`/data/v1/metrics/${a.metric}/timeseries`,{'timeframe[]':tf(a),'filters[]':filters(a),group_by:a.group_by}));
expose('mux_metric_breakdown','Break down a metric by an available Mux dimension.',metricArgs.extend({group_by:z.string().min(1).max(80).regex(/^[a-z_]+$/).default('video_title'),...paging}),a=>muxGet(`/data/v1/metrics/${a.metric}/breakdown`,{'timeframe[]':tf(a),'filters[]':filters(a),group_by:a.group_by,limit:a.limit,page:a.page}));
// Optional: these GET endpoints additionally require Mux Video READ scope on the token.
expose('mux_list_assets','List Mux Video assets. Requires optional Video READ token permission.',z.object({...paging,cursor:z.string().max(1024).optional()}),a=>muxGet('/video/v1/assets',{limit:a.limit,page:a.page,cursor:a.cursor}));
expose('mux_get_asset','Read one Mux Video asset metadata (including duration, playback IDs and passthrough). Requires Video READ.',z.object({asset_id:id}),a=>muxGet(`/video/v1/assets/${a.asset_id}`));

serveStdio(() => server);
