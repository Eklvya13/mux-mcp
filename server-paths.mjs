const whitelist = [
  /^\/data\/v1\/video-views$/,
  /^\/data\/v1\/video-views\/[A-Za-z0-9_-]+$/,
  /^\/data\/v1\/dimensions$/,
  /^\/data\/v1\/dimensions\/[A-Za-z0-9_-]+$/,
  /^\/data\/v1\/metrics\/[a-z_]+\/(overall|breakdown|timeseries)$/,
  /^\/video\/v1\/assets$/,
  /^\/video\/v1\/assets\/[A-Za-z0-9_-]+$/
];
export function allowedPath(path) { return whitelist.some(re => re.test(path)); }

