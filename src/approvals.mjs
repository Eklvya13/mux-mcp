import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

export const APPROVAL_TTL_MS = 120_000;
const root = () => path.join(os.homedir(), '.mux-mcp-approvals');
function key(operation, assetId, detailId='') {
  return crypto.createHash('sha256').update(JSON.stringify([operation, assetId, detailId])).digest('hex');
}
function filePath(operation, assetId, detailId='') {
  return path.join(root(), `${key(operation, assetId, detailId)}.json`);
}
export function createApproval(operation, assetId, detailId='', now=Date.now()) {
  if (!['asset','track','playback_id'].includes(operation)) throw new Error('Invalid deletion operation');
  fs.mkdirSync(root(), { recursive: true, mode: 0o700 });
  fs.chmodSync(root(), 0o700);
  const record = { operation, assetId, detailId, expires: now + APPROVAL_TTL_MS, nonce: crypto.randomUUID() };
  const target = filePath(operation, assetId, detailId);
  fs.writeFileSync(target, JSON.stringify(record), { mode: 0o600, flag: 'w' });
  fs.chmodSync(target, 0o600);
  return record.expires;
}
export function consumeApproval(operation, assetId, detailId='', now=Date.now()) {
  const target = filePath(operation, assetId, detailId);
  const claimed = `${target}.${crypto.randomUUID()}.claimed`;
  try {
    fs.renameSync(target, claimed); // only one concurrent consumer gets the file
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('No local operator approval. Run npm run approve-delete in a terminal on the MCP host.');
    throw err;
  }
  try {
    const stat = fs.statSync(claimed);
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('Approval file permissions are unsafe');
    const record = JSON.parse(fs.readFileSync(claimed, 'utf8'));
    if (record.operation !== operation || record.assetId !== assetId || record.detailId !== detailId || !record.nonce || record.expires < now || record.expires > now + APPROVAL_TTL_MS) {
      throw new Error('Approval expired or does not match the exact deletion target');
    }
    return true;
  } finally { fs.rmSync(claimed, { force: true }); }
}
