const secretKeys = /(?:^|_)(?:stream_key|private_key|signing_key|password|secret|authorization|api_token|access_token|refresh_token|jwt|credentials?)$/i;
export function sanitize(value, maxItems=100, depth=0) {
  if (depth > 20) return '[NESTING LIMIT]';
  if (typeof value === 'string') {
    return value.replace(/([?&](?:x-amz-[a-z-]+|x-goog-[a-z-]+|token|signature|sig|jwt|key|access_token|expires|policy)=)[^&\s]+/gi, '$1[REDACTED]');
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, maxItems).map(item => sanitize(item, maxItems, depth+1));
    if (value.length > maxItems) items.push({ omitted_items: value.length - maxItems });
    return items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, secretKeys.test(k) ? '[REDACTED]' : sanitize(v, maxItems, depth+1)]));
  }
  return value;
}
export function resultText(data, config) {
  let output = JSON.stringify(sanitize(data, config.maxItems));
  // Safely cap pathological single-record responses, never emit a broken JSON fragment.
  if (Buffer.byteLength(output) > 130_000) {
    output = JSON.stringify({ truncated: true, message: 'Response exceeds MCP output budget. Narrow filters or pagination, use summary mode, or lower MUX_MAX_RESPONSE_ITEMS.', preview: output.slice(0, 6_000) });
  }
  return { content: [{ type: 'text', text: output }] };
}

