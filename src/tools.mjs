import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { createClient } from './client.mjs';
import { allowTool, requireDeleteEnabled } from './permissions.mjs';
import { consumeApproval } from './approvals.mjs';
import { resultText } from './format.mjs';

const id = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/);
const metricId = z.string().min(2).max(100).regex(/^[a-z][a-z_]*$/).describe('Mux historical metric name, e.g. views, playing_time, rebuffer_percentage');
const dimensionId = z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/);
const monitorMetricId = z.string().min(3).max(90).regex(/^[a-z][a-z-]*$/);
const page = { limit: z.number().int().min(1).max(100).default(25), page: z.number().int().min(1).max(10000).default(1) };
const timeframe = {
  days: z.number().int().min(1).max(365).default(7).describe('Relative days, ignored if both Unix timestamps are provided'),
  start_epoch: z.number().int().positive().optional(),
  end_epoch: z.number().int().positive().optional()
};
const filter = z.string().min(3).max(300).regex(/^[!+\-]?[a-z][a-z0-9_]*:[^\r\n]+$/);
const sharedFilters = {
  viewer_user_id: z.string().max(256).optional(),
  asset_id: z.string().max(256).optional(),
  video_id: z.string().max(256).optional(),
  playback_id: z.string().max(256).optional(),
  video_title: z.string().max(256).optional(),
  additional_filter: filter.optional().describe('Single Mux filter expression, e.g. country:US'),
  filters: z.array(filter).max(10).default([]).describe('Additional Mux dimension filters')
};
const analysisArgs = z.object({ ...timeframe, ...sharedFilters });
const pagingArgs = z.object(page);
const viewingArgs = analysisArgs.extend({ ...page, viewer_id: z.string().max(256).optional(), order_direction: z.enum(['asc','desc']).default('desc') });
const metricArgs = analysisArgs.extend({ metric: metricId });
const order = { order_direction: z.enum(['asc', 'desc']).default('desc') };
const subtitleLang = z.string().min(2).max(35).regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/);
const trackFields = {
  language_code: subtitleLang.optional(),
  name: z.string().min(1).max(255).optional(),
  closed_captions: z.boolean().optional(),
  passthrough: z.string().max(255).optional()
};

function timeQuery(args) {
  if ((args.start_epoch === undefined) !== (args.end_epoch === undefined)) throw new Error('Provide both start_epoch and end_epoch');
  if (args.start_epoch !== undefined) {
    if (args.start_epoch >= args.end_epoch) throw new Error('start_epoch must be earlier than end_epoch');
    return [args.start_epoch, args.end_epoch];
  }
  return [`${args.days}:days`];
}
function filterQuery(args) {
  const result = [];
  for (const key of ['viewer_user_id','asset_id','video_id','playback_id','video_title']) {
    if (args[key]) result.push(`${key}:${args[key]}`);
  }
  if (args.additional_filter) result.push(args.additional_filter);
  return result.concat(args.filters || []);
}
function analyticQuery(args) { return { 'timeframe[]': timeQuery(args), 'filters[]': filterQuery(args) }; }
function pick(object, keys) { return Object.fromEntries(keys.filter(key => object[key] !== undefined).map(key => [key, object[key]])); }
function validateHttpsPublicUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || /(^localhost$|\.localhost$|\.local$)/i.test(url.hostname) || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) {
    throw new Error('Subtitle URL must be a public HTTPS hostname without embedded credentials or an IP address');
  }
  return value;
}
export function buildServer(config, fetcher=fetch) {
  const api = createClient(config, fetcher);
  const server = new McpServer({ name: 'mux-mcp', version: '2.0.0' });
  const registered = [];
  function expose(name, description, schema, handler, { level='read', deleteKind } = {}) {
    if (!allowTool(config, level, deleteKind)) return;
    registered.push(name);
    server.registerTool(name, {
      description: `${level.toUpperCase()}: ${description}`,
      inputSchema: schema,
      annotations: { readOnlyHint: level === 'read', destructiveHint: level === 'admin', idempotentHint: level === 'read', openWorldHint: true }
    }, async (input) => {
      try { return resultText(await handler(input), config); }
      catch (err) { return { isError: true, content: [{ type: 'text', text: String(err.message || 'Unknown error') }] }; }
    });
  }

  expose('mux_server_capabilities', 'Show enabled operations and safety controls; does not reveal credentials.', z.object({}), () => ({
    version: '2.0.0', mode: config.mode, tool_count: registered.length,
    permissions: { read: !!(config.read.id && config.read.secret), write: config.mode !== 'readonly' && !!(config.write.id && config.write.secret), asset_delete: allowTool(config, 'admin', 'asset'), track_delete: allowTool(config, 'admin', 'track'), playback_id_delete: allowTool(config, 'admin', 'playback_id') },
    excluded: ['upload assets', 'create assets', 'create live streams', 'create direct uploads', 'generic HTTP requests'],
    deletion: 'Requires local interactive approval for each exact target within two minutes.'
  }));

  // Original nine tools: names retained for old clients.
  expose('mux_list_video_views', 'List view sessions with page-based pagination and viewer filters.', viewingArgs,
    a => api('GET','/data/v1/video-views', {params:{ ...analyticQuery(a), viewer_id:a.viewer_id, limit:a.limit, page:a.page, order_direction:a.order_direction }}));
  expose('mux_get_video_view', 'Inspect one viewing session. Summary mode omits the potentially huge event list by default.', z.object({ view_id:id, response_mode:z.enum(['summary','full']).default('summary') }), async a => {
    const raw = await api('GET',`/data/v1/video-views/${a.view_id}`);
    if (a.response_mode === 'full') return raw;
    const data = raw.data || {};
    const { events, playback_events, ...summary } = data;
    return { ...raw, data:summary, excluded_event_count: Array.isArray(events) ? events.length : Array.isArray(playback_events) ? playback_events.length : 0 };
  });
  expose('mux_list_dimensions', 'Discover historical Mux Data dimensions.', z.object({}), () => api('GET','/data/v1/dimensions'));
  expose('mux_dimension_values', 'List values for a historical dimension.', z.object({ dimension:dimensionId, ...timeframe, ...page }), a => api('GET',`/data/v1/dimensions/${a.dimension}`,{params:{'timeframe[]':timeQuery(a), limit:a.limit,page:a.page}}));
  expose('mux_metric_overall', 'Fetch overall historical metric. Metric IDs are not frozen to a short list.', metricArgs, a => api('GET',`/data/v1/metrics/${a.metric}/overall`,{params:analyticQuery(a)}));
  expose('mux_metric_breakdown', 'Break down historical metric by dimension. Group label is in field.', metricArgs.extend({group_by:dimensionId.default('video_title'), ...page, ...order, order_by:z.enum(['negative_impact','value','views','field']).optional()}), a=>api('GET',`/data/v1/metrics/${a.metric}/breakdown`,{params:{...analyticQuery(a),...pick(a,['group_by','limit','page','order_direction','order_by'])}}));
  expose('mux_metric_timeseries', 'Historical metric time series.', metricArgs.extend({group_by:z.enum(['minute','ten_minutes','hour','day']).default('day')}), a=>api('GET',`/data/v1/metrics/${a.metric}/timeseries`,{params:{...analyticQuery(a),group_by:a.group_by}}));
  expose('mux_list_assets', 'List existing Mux Video assets. Requires Video:Read permission.', z.object({...page,cursor:z.string().max(1024).optional()}), a=>api('GET','/video/v1/assets',{params:pick(a,['limit','page','cursor'])}));
  expose('mux_get_asset', 'Get one asset including metadata, playback IDs, tracks and status.', z.object({asset_id:id}), a=>api('GET',`/video/v1/assets/${a.asset_id}`));

  // Additional Mux Data endpoints; all use the same read-only credential and path allowlist.
  expose('mux_list_filters', 'Discover filter dimensions supported by Mux Data.', z.object({}),()=>api('GET','/data/v1/filters'));
  expose('mux_filter_values', 'List values for one Mux Data filter.', z.object({filter:dimensionId, ...timeframe, ...page}),a=>api('GET',`/data/v1/filters/${a.filter}`,{params:{'timeframe[]':timeQuery(a),limit:a.limit,page:a.page}}));
  expose('mux_list_errors', 'List common playback errors over a timeframe.',analysisArgs.extend({...page}),a=>api('GET','/data/v1/errors',{params:{...analyticQuery(a),limit:a.limit,page:a.page}}));
  expose('mux_metric_insights', 'Find negatively impacting dimensions for a historical metric.',metricArgs.extend({...page}),a=>api('GET',`/data/v1/metrics/${a.metric}/insights`,{params:{...analyticQuery(a),limit:a.limit,page:a.page}}));
  expose('mux_metric_comparison', 'List metric values for a specified Mux dimension/value pair or the overall population.',analysisArgs.extend({dimension:dimensionId.optional(),value:z.string().max(256).optional()}),a=>{
    if ((a.dimension===undefined)!==(a.value===undefined)) throw new Error('Supply dimension and value together');
    return api('GET','/data/v1/metrics/comparison',{params:{...analyticQuery(a),...pick(a,['dimension','value'])}});
  });
  expose('mux_list_monitoring_dimensions', 'Discover Mux Monitoring dimensions (plan dependent).',z.object({}),()=>api('GET','/data/v1/monitoring/dimensions'));
  expose('mux_list_monitoring_metrics', 'Discover Mux Monitoring metrics (plan dependent).',z.object({}),()=>api('GET','/data/v1/monitoring/metrics'));
  expose('mux_monitoring_timeseries', 'Monitoring metric at five-second intervals (plan dependent).',z.object({metric:monitorMetricId,timestamp:z.number().int().positive().optional(),filters:z.array(filter).max(10).default([])}),a=>api('GET',`/data/v1/monitoring/metrics/${a.metric}/timeseries`,{params:{timestamp:a.timestamp,'filters[]':a.filters}}));
  expose('mux_monitoring_breakdown', 'Break down monitoring metric by dimension (plan dependent).',z.object({metric:monitorMetricId,dimension:dimensionId,timestamp:z.number().int().positive().optional(),filters:z.array(filter).max(10).default([]),...order}),a=>api('GET',`/data/v1/monitoring/metrics/${a.metric}/breakdown`,{params:{dimension:a.dimension,timestamp:a.timestamp,'filters[]':a.filters,order_direction:a.order_direction}}));
  expose('mux_engagement', 'Get engagement heatmap or hotspots by asset, video ID, or playback ID (availability may depend on plan).',z.object({entity:z.enum(['assets','videos','playback-ids']),id,kind:z.enum(['heatmap','hotspots']),...timeframe}),a=>api('GET',`/data/v1/engagement/${a.entity}/${a.id}/${a.kind}`,{params:{'timeframe[]':timeQuery(a)}}));

  // Video inventory reads.
  expose('mux_list_asset_tracks', 'Inspect text/subtitle, audio and video tracks for one asset.',z.object({asset_id:id}),async a=>{
    const response=await api('GET',`/video/v1/assets/${a.asset_id}`);
    return { asset_id:a.asset_id, asset_status:response.data?.status, tracks:response.data?.tracks ?? [] };
  });
  expose('mux_get_asset_input_info', 'Inspect asset input source details (may contain URLs; query tokens are redacted).',z.object({asset_id:id}),a=>api('GET',`/video/v1/assets/${a.asset_id}/input-info`));
  expose('mux_get_asset_playback_id', 'Read settings for an existing asset playback ID.',z.object({asset_id:id,playback_id:id}),a=>api('GET',`/video/v1/assets/${a.asset_id}/playback-ids/${a.playback_id}`));
  expose('mux_lookup_playback_id', 'Resolve a playback ID to its asset or live stream.',z.object({playback_id:id}),a=>api('GET',`/video/v1/playback-ids/${a.playback_id}`));
  expose('mux_list_live_streams', 'List existing live streams (stream keys are always redacted).',pagingArgs,a=>api('GET','/video/v1/live-streams',{params:pick(a,['limit','page'])}));
  expose('mux_get_live_stream', 'Read existing live stream details (stream key always redacted).',z.object({live_stream_id:id}),a=>api('GET',`/video/v1/live-streams/${a.live_stream_id}`));
  expose('mux_list_playback_restrictions', 'List existing playback restriction policies.',pagingArgs,a=>api('GET','/video/v1/playback-restrictions',{params:pick(a,['limit','page'])}));
  expose('mux_get_playback_restriction', 'Inspect existing playback restriction policy.',z.object({restriction_id:id}),a=>api('GET',`/video/v1/playback-restrictions/${a.restriction_id}`));

  // Multi-page read helpers cap pages to bound cost and prevent accidental huge scans.
  async function auditAssets(pages, predicate, project) {
    let checked = 0, matches = [], nextPage = 1;
    for (let p=1;p<=pages;p++) {
      const response = await api('GET','/video/v1/assets',{params:{limit:100,page:p}});
      const assets = Array.isArray(response.data) ? response.data : [];
      checked += assets.length;
      for (const asset of assets) if (predicate(asset)) matches.push(project(asset));
      nextPage = p+1;
      if (assets.length < 100) break;
    }
    return { scanned_assets:checked, matching_assets:matches.slice(0,200), omitted_matches:Math.max(0,matches.length-200), scanned_up_to_page:nextPage-1, note:'Bounded scan, not necessarily the entire Mux account.' };
  }
  expose('mux_audit_asset_metadata', 'Find assets with missing title, creator_id or external_id; bounded page scan.',z.object({pages:z.number().int().min(1).max(5).default(2)}),a=>auditAssets(a.pages,x=>!x.meta?.title || !x.meta?.creator_id || !x.meta?.external_id,x=>({id:x.id,title:x.meta?.title??null,creator_id:x.meta?.creator_id??null,external_id:x.meta?.external_id??null,status:x.status})));
  expose('mux_find_assets_without_subtitles', 'Find assets without text subtitle tracks; bounded page scan.',z.object({pages:z.number().int().min(1).max(5).default(2)}),a=>auditAssets(a.pages,x=>!(x.tracks||[]).some(t=>t.type==='text' && t.text_type==='subtitles' && t.status!=='deleted'),x=>({id:x.id,title:x.meta?.title??null,status:x.status})));
  expose('mux_compare_metric_periods', 'Compare a historical metric for two immediately adjacent equal-length UTC ranges.',z.object({metric:metricId,start_epoch:z.number().int().positive(),end_epoch:z.number().int().positive(),filters:z.array(filter).max(10).default([])}),async a=>{
    if (a.start_epoch >= a.end_epoch) throw new Error('Invalid time interval');
    const span = a.end_epoch-a.start_epoch;
    const q=(start,end)=>({'timeframe[]':[start,end],'filters[]':a.filters});
    const current=await api('GET',`/data/v1/metrics/${a.metric}/overall`,{params:q(a.start_epoch,a.end_epoch)});
    const previous=await api('GET',`/data/v1/metrics/${a.metric}/overall`,{params:q(a.start_epoch-span,a.start_epoch)});
    const cv=Number(current.data?.value),pv=Number(previous.data?.value);
    return {metric:a.metric,current_timeframe:[a.start_epoch,a.end_epoch],previous_timeframe:[a.start_epoch-span,a.start_epoch],current:current.data,previous:previous.data,absolute_change:Number.isFinite(cv)&&Number.isFinite(pv)?cv-pv:null,percentage_change:Number.isFinite(cv)&&Number.isFinite(pv)&&pv!==0?((cv-pv)/Math.abs(pv))*100:null,note:'Metric definitions and aggregation populations vary; compare like-for-like metrics only.'};
  });
  expose('mux_analytics_summary', 'Fetch a compact overall analytics dashboard for selected historical metrics.',analysisArgs.extend({metrics:z.array(metricId).min(1).max(6).default(['views','playing_time','viewer_experience_score','rebuffer_percentage'])}),async a=>{
    const rows=[];
    for (const metric of a.metrics) {
      const response=await api('GET',`/data/v1/metrics/${metric}/overall`,{params:analyticQuery(a)});
      rows.push({metric, ...response.data, timeframe:response.timeframe, aggregation:response.meta?.aggregation});
    }
    return {metrics:rows,note:'Totals and aggregation population may differ between metrics; durations are generally in milliseconds where specified by Mux.'};
  });

  // Write tools only appear when explicitly enabled AND separate write credentials exist.
  expose('mux_update_asset_metadata', 'Update an existing asset metadata/passthrough/thumbnail time. Existing unspecified meta fields are preserved. Never include PII in public metadata.', z.object({ asset_id:id, title:z.string().max(512).optional(), creator_id:z.string().max(128).optional(), external_id:z.string().max(128).optional(), passthrough:z.string().max(255).optional(), thumbnail_time:z.number().nonnegative().optional() }), async a=>{
    const before=await api('GET',`/video/v1/assets/${a.asset_id}`);
    const meta=pick(a,['title','creator_id','external_id']);
    const body={...pick(a,['passthrough','thumbnail_time'])};
    if (Object.keys(meta).length) body.meta={...pick(before.data?.meta||{},['title','creator_id','external_id']),...meta};
    if (!Object.keys(body).length) throw new Error('Supply at least one metadata field to change');
    return api('PATCH',`/video/v1/assets/${a.asset_id}`,{body});
  },{level:'write'});
  expose('mux_create_subtitle_track', 'Add an existing public HTTPS SRT/WebVTT URL to an existing ready asset. Does not upload files or create assets.',z.object({ asset_id:id, url:z.url(), language_code:subtitleLang, name:z.string().min(1).max(255), closed_captions:z.boolean().default(false), passthrough:z.string().max(255).optional(),text_type:z.enum(['subtitles','chapters']).default('subtitles') }), async a=>{
    const asset=await api('GET',`/video/v1/assets/${a.asset_id}`);
    if (asset.data?.status !== 'ready') throw new Error('Mux asset must be ready before adding a track');
    return api('POST',`/video/v1/assets/${a.asset_id}/tracks`,{body:{url:validateHttpsPublicUrl(a.url),type:'text',text_type:a.text_type,language_code:a.language_code,name:a.name,closed_captions:a.closed_captions,...pick(a,['passthrough'])}});
  },{level:'write'});
  expose('mux_update_asset_track', 'Update details of an existing text or secondary audio track; cannot update a primary audio or video track.',z.object({asset_id:id,track_id:id,...trackFields}),async a=>{
    const asset=await api('GET',`/video/v1/assets/${a.asset_id}`);
    const track=(asset.data?.tracks||[]).find(t=>t.id===a.track_id);
    if (!track || (track.type!=='text' && !(track.type==='audio' && !track.primary))) throw new Error('Track is missing or is not an editable text/secondary audio track');
    const body=pick(a,['language_code','name','closed_captions','passthrough']);
    if (!Object.keys(body).length) throw new Error('Supply at least one track field to change');
    return api('PATCH',`/video/v1/assets/${a.asset_id}/tracks/${a.track_id}`,{body});
  },{level:'write'});
  expose('mux_create_asset_playback_id', 'Create playback ID for existing asset. Signed only unless public playback flag is explicitly enabled. No asset creation.',z.object({asset_id:id,policy:z.enum(['signed','public']).default('signed')}),async a=>{
    if (a.policy==='public' && !config.enablePublicPlaybackId) throw new Error('Creating PUBLIC playback IDs requires MUX_ENABLE_PUBLIC_PLAYBACK_ID=true');
    return api('POST',`/video/v1/assets/${a.asset_id}/playback-ids`,{body:{policy:a.policy}});
  },{level:'write'});

  // Destructive tools only appear in admin+action flag+write credentials.
  expose('mux_delete_asset', 'Permanently delete one existing asset. Requires matching local operator approval, consumed once.',z.object({asset_id:id}),async a=>{
    requireDeleteEnabled(config,'asset');
    await api('GET',`/video/v1/assets/${a.asset_id}`);
    consumeApproval('asset',a.asset_id);
    return api('DELETE',`/video/v1/assets/${a.asset_id}`);
  },{level:'admin',deleteKind:'asset'});
  expose('mux_delete_asset_track', 'Permanently remove only a text or secondary audio track after local operator approval.',z.object({asset_id:id,track_id:id}),async a=>{
    requireDeleteEnabled(config,'track');
    const asset=await api('GET',`/video/v1/assets/${a.asset_id}`);
    const track=(asset.data?.tracks||[]).find(t=>t.id===a.track_id);
    if (!track || (track.type!=='text' && !(track.type==='audio' && !track.primary))) throw new Error('Track is missing or is not removable');
    consumeApproval('track',a.asset_id,a.track_id);
    return api('DELETE',`/video/v1/assets/${a.asset_id}/tracks/${a.track_id}`);
  },{level:'admin',deleteKind:'track'});
  expose('mux_delete_asset_playback_id', 'Revoke playback access for an asset playback ID; local approval required.',z.object({asset_id:id,playback_id:id}),async a=>{
    requireDeleteEnabled(config,'playback_id');
    const asset=await api('GET',`/video/v1/assets/${a.asset_id}`);
    if (!(asset.data?.playback_ids||[]).some(p=>p.id===a.playback_id)) throw new Error('Playback ID does not belong to the selected asset');
    consumeApproval('playback_id',a.asset_id,a.playback_id);
    return api('DELETE',`/video/v1/assets/${a.asset_id}/playback-ids/${a.playback_id}`);
  },{level:'admin',deleteKind:'playback_id'});
  return { server, registered };
}
