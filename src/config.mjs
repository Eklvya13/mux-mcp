const truth = value => String(value).toLowerCase() === 'true';
const intEnv = (name, fallback, min, max, env) => {
  const value = Number(env[name]);
  return env[name] && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
};
export function getConfig(env = process.env) {
  const mode = ['readonly', 'write', 'admin'].includes(env.MUX_ACCESS_MODE) ? env.MUX_ACCESS_MODE : 'readonly';
  return Object.freeze({
    mode,
    read: { id: env.MUX_TOKEN_ID || '', secret: env.MUX_TOKEN_SECRET || '' },
    write: { id: env.MUX_WRITE_TOKEN_ID || '', secret: env.MUX_WRITE_TOKEN_SECRET || '' },
    enableAssetDelete: truth(env.MUX_ENABLE_ASSET_DELETE),
    enableTrackDelete: truth(env.MUX_ENABLE_TRACK_DELETE),
    enablePlaybackIdDelete: truth(env.MUX_ENABLE_PLAYBACK_ID_DELETE),
    enablePublicPlaybackId: truth(env.MUX_ENABLE_PUBLIC_PLAYBACK_ID),
    timeoutMs: intEnv('MUX_REQUEST_TIMEOUT_MS', 20000, 1000, 60000, env),
    maxItems: intEnv('MUX_MAX_RESPONSE_ITEMS', 200, 10, 500, env)
  });
}
