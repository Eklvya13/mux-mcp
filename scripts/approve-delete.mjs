#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createApproval } from '../src/approvals.mjs';

const [operation, assetId, detailId=''] = process.argv.slice(2);
if (!stdin.isTTY || !stdout.isTTY) {
  console.error('Interactive terminal required; cannot approve via a pipe or headless script.');
  process.exit(1);
}
if (!['asset','track','playback_id'].includes(operation) || !/^[A-Za-z0-9_-]{1,256}$/.test(assetId||'') || ((operation !== 'asset') !== Boolean(detailId)) || (detailId && !/^[A-Za-z0-9_-]{1,256}$/.test(detailId))) {
  console.error('Usage: npm run approve-delete -- asset ASSET_ID\n       npm run approve-delete -- track ASSET_ID TRACK_ID\n       npm run approve-delete -- playback_id ASSET_ID PLAYBACK_ID');
  process.exit(1);
}
const label = `${operation} ${assetId}${detailId ? ` ${detailId}` : ''}`;
console.log(`DANGER: Approving a Mux deletion of ${label}. Approval expires after 2 minutes.`);
const rl = readline.createInterface({ input: stdin, output: stdout });
try {
  const answer = await rl.question(`Type exactly DELETE ${label} to approve: `);
  if (answer !== `DELETE ${label}`) { console.error('Not approved.'); process.exitCode = 1; }
  else { createApproval(operation, assetId, detailId); console.log('Approved once. Return to your MCP client and issue the exact delete command.'); }
} finally { rl.close(); }
