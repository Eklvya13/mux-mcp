export const CAPABILITIES = Object.freeze({
  read: 0, write: 1, admin: 2
});
const levels = { readonly: 0, write: 1, admin: 2 };
export function requireAccess(config, operation) {
  const need = CAPABILITIES[operation];
  if (need === undefined) throw new Error('Unknown operation permission');
  if ((levels[config.mode] ?? 0) < need) {
    throw new Error(`Operation requires ${operation} permission; current mode is ${config.mode}.`);
  }
  if (need > 0 && (!config.write.id || !config.write.secret)) {
    throw new Error('Separate MUX_WRITE_TOKEN_ID and MUX_WRITE_TOKEN_SECRET are required.');
  }
  if (need === 0 && (!config.read.id || !config.read.secret)) {
    throw new Error('MUX_TOKEN_ID and MUX_TOKEN_SECRET are required for reads.');
  }
}
export function requireDeleteEnabled(config, operation) {
  requireAccess(config, 'admin');
  const flags = { asset: 'enableAssetDelete', track: 'enableTrackDelete', playback_id: 'enablePlaybackIdDelete' };
  if (!flags[operation] || !config[flags[operation]]) throw new Error(`Deletion of ${operation} is disabled by configuration.`);
}
export function allowTool(config, level, deleteKind) {
  const n = { readonly: 0, write: 1, admin: 2 }[config.mode] ?? 0;
  if (n < CAPABILITIES[level]) return false;
  if (level !== 'read' && (!config.write.id || !config.write.secret)) return false;
  if (deleteKind) {
    const flags = { asset: config.enableAssetDelete, track: config.enableTrackDelete, playback_id: config.enablePlaybackIdDelete };
    return Boolean(flags[deleteKind]);
  }
  return true;
}
