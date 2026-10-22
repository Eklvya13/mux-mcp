import { requireAccess } from './permissions.mjs';

// Fixed origin and per-method fixed route patterns. No general HTTP-request tool.
const ROUTES = {
  GET: [
    /^\/data\/v1\/(video-views|dimensions|filters|errors)$/,
    /^\/data\/v1\/video-views\/[A-Za-z0-9_-]+$/,
    /^\/data\/v1\/(dimensions|filters)\/[a-zA-Z0-9_-]+$/,
    /^\/data\/v1\/metrics\/[a-z_]+\/(overall|breakdown|timeseries|insights)$/,
    /^\/data\/v1\/metrics\/comparison$/,
    /^\/data\/v1\/monitoring\/(dimensions|metrics)$/,
    /^\/data\/v1\/monitoring\/metrics\/[a-z-]+\/(breakdown|timeseries)$/,
    /^\/data\/v1\/engagement\/(assets|videos|playback-ids)\/[A-Za-z0-9_-]+\/(heatmap|hotspots)$/,
    /^\/video\/v1\/assets$/,
    /^\/video\/v1\/assets\/[A-Za-z0-9_-]+$/,
    /^\/video\/v1\/assets\/[A-Za-z0-9_-]+\/input-info$/,
    /^\/video\/v1\/assets\/[A-Za-z0-9_-]+\/playback-ids\/[A-Za-z0-9_-]+$/,
    /^\/video\/v1\/live-streams(?:\/[A-Za-z0-9_-]+)?$/,
    /^\/video\/v1\/playback-restrictions(?:\/[A-Za-z0-9_-]+)?$/,
    /^\/video\/v1\/playback-ids\/[A-Za-z0-9_-]+$/
  ],
  PATCH: [
    /^\/video\/v1\/assets\/[A-Za-z0-9_-]+$/,
    /^\/video\/v1\/assets\/[A-Za-z0-9_-]+\/tracks\/[A-Za-z0-9_-]+$/
  ],
  POST: [
    /^\/video\/v1\/assets\/[A-Za-z0-9_-]+\/tracks$/,
    /^\/video\/v1\/assets\/[A-Za-z0-9_-]+\/playback-ids$/
  ],
  DELETE: [
    /^\/video\/v1\/assets\/[A-Za-z0-9_-]+$/,
    /^\/video\/v1\/assets\/[A-Za-z0-9_-]+\/tracks\/[A-Za-z0-9_-]+$/,
    /^\/video\/v1\/assets\/[A-Za-z0-9_-]+\/playback-ids\/[A-Za-z0-9_-]+$/
  ]
};
export function allowedRoute(method, path) {
  return (ROUTES[method] || []).some(pattern => pattern.test(path));
}
export function queryUrl(path, params={}) {
  const url = new URL(path, 'https://api.mux.com');
  if (url.origin !== 'https://api.mux.com') throw new Error('Invalid API origin');
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach(v => url.searchParams.append(key, String(v)));
    else url.searchParams.set(key, String(value));
  }
  return url;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function createClient(config, fetcher = fetch) {
  return async function request(method, path, { params = {}, body } = {}) {
    if (!allowedRoute(method, path)) throw new Error(`Blocked: ${method} endpoint is not allowlisted`);
    requireAccess(config, method === 'GET' ? 'read' : 'write');
    const credential = method === 'GET' ? config.read : config.write;
    const url = queryUrl(path, params);
    const auth = Buffer.from(`${credential.id}:${credential.secret}`).toString('base64');
    const maxAttempts = method === 'GET' ? 3 : 1; // never automatically retry mutations
    for (let attempt=0; attempt<maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const res = await fetcher(url, {
          method,
          headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: 'error', signal: controller.signal
        });
        if (method === 'GET' && [429,500,502,503,504].includes(res.status) && attempt < maxAttempts-1) {
          await res.body?.cancel?.();
          await sleep(200 * 2 ** attempt);
          continue;
        }
        // Do not leak Mux response bodies, which may contain signed URLs or secrets.
        if (!res.ok) throw new Error(`Mux API returned HTTP ${res.status}${res.headers?.get?.('x-request-id') ? ` (request id ${res.headers.get('x-request-id')})` : ''}`);
        if (res.status === 204) return { success: true, status: 204 };
        const size = Number(res.headers?.get?.('content-length') ?? 0);
        if (size > 3_000_000) throw new Error('Mux API response too large; narrow your request');
        const text = await res.text();
        if (Buffer.byteLength(text) > 3_000_000) throw new Error('Mux API response too large; narrow your request');
        return text ? JSON.parse(text) : { success: true, status: res.status };
      } catch (err) {
        if (err.name === 'AbortError') throw new Error('Mux API request timed out');
        if (err instanceof SyntaxError) throw new Error('Mux API returned invalid JSON');
        throw err;
      } finally { clearTimeout(timeout); }
    }
  };
}
