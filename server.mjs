import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { getConfig } from './src/config.mjs';
import { buildServer } from './src/tools.mjs';

const config = getConfig();
if (!config.read.id || !config.read.secret) {
  console.error('Mux MCP requires MUX_TOKEN_ID and MUX_TOKEN_SECRET. Check your Claude MCP environment configuration.');
  process.exit(1);
}
const { server } = buildServer(config);
// All protocol messages are on stdout; diagnostics on stderr only.
serveStdio(() => server);
