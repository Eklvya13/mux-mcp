# Mux Data read-only local MCP server

## Security
- HTTP requests are hard-coded to `GET` and fixed `https://api.mux.com` endpoints. No arbitrary URL or HTTP tool, no POST/PATCH/PUT/DELETE, no file/database tools.
- **In Mux Dashboard create a token with `Mux Data: Read` only. Set Mux Data Write, Mux Video Write, and System Write to NONE.**
- For optional `mux_list_assets` / `mux_get_asset`, enable `Mux Video: Read`. If unavailable, leave disabled and those two tools will return an authorization error. All other tools work with Mux Data Read access as permitted by your plan.
- Credential secret stays in local Claude MCP process environment. Do not paste credentials into a chat, repository, or MCP tool input.
- Only run trusted MCP servers; this server can still read and transmit sensitive view data to your configured Claude service when tools are called.

## Requirements
Node.js 20+ and npm. Compatible MCP client with stdio, e.g. Claude Desktop or Claude Code. `Claude.ai` browser-only remote connectors generally cannot connect to a laptop-local stdio process.

## Installation
```bash
cd mux-readonly-mcp
npm install
npm run check
npm test
```

## Claude Desktop configuration
Open Claude Desktop's MCP configuration file. On macOS the typical path is `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows: `%APPDATA%\\Claude\\claude_desktop_config.json`.

Merge this into existing `mcpServers` JSON object (do NOT overwrite your existing connectors):
```json
{
  "mcpServers": {
    "mux-data-readonly": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/mux-readonly-mcp/server.mjs"],
      "env": {
        "MUX_TOKEN_ID": "YOUR_READ_ONLY_TOKEN_ID",
        "MUX_TOKEN_SECRET": "YOUR_READ_ONLY_TOKEN_SECRET"
      }
    }
  }
}
```
Restart Claude Desktop. Consider handling secrets via your OS's secret store instead of saving secrets directly in the config file.

## Claude Code
Configure local stdio MCP using Claude Code MCP configuration/CLI. For example:
```bash
claude mcp add mux-data-readonly --env MUX_TOKEN_ID=YOUR_READ_ONLY_TOKEN_ID --env MUX_TOKEN_SECRET=YOUR_READ_ONLY_TOKEN_SECRET -- node /ABSOLUTE/PATH/TO/mux-readonly-mcp/server.mjs
```
Do not commit shell history or config containing tokens. For more private handling, use environment management supported by your machine.

## Tools
- `mux_list_video_views`: paginated sessions, filters for `viewer_user_id`, `asset_id`, `video_id`, `playback_id`, `video_title`, UTC epoch range or last N days; `view_end` defines window.
- `mux_get_video_view`: full view, including `events`, playback and viewing metadata.
- `mux_list_dimensions`, `mux_dimension_values`: discover values.
- `mux_metric_overall`, `mux_metric_timeseries`, `mux_metric_breakdown`: aggregated metric reporting.
- `mux_list_assets`, `mux_get_asset`: optional Video READ asset metadata.

## Important interpretation
- Mux Data `viewer_user_id` is an integration-defined user ID and is NOT the Mux-generated `viewer_id` parameter. If your app sets it equal to the Supabase user UUID, joins are straightforward.
- `video_id` is integration-specified and is not guaranteed to equal `asset_id`. `asset_id` and `playback_id` can be absent on non-Mux playback.
- `watch_time`, `view_playing_time`, `view_max_playhead_position`, `video_duration` are milliseconds. Cumulative playing time and furthest position aren't proof of distinct video segments watched or course completion.
- Video view listing is limited to sessions with `view_end` within the timeframe. Recently started sessions might not yet appear.
- `mux_list_video_views` is paginated; follow `total_row_count` and increment `page`. For high-volume reporting collect pages, preferably with bounded date windows. `limit` is capped to 100 in this server.
- Metric aggregation can follow slightly different time semantics; see Mux docs.

## Verified documentation
- https://www.mux.com/docs/api-reference/data/video-views/list-video-views
- https://www.mux.com/docs/api-reference/data/video-views/get-video-view
- https://www.mux.com/docs/guides/export-raw-video-view-data
- https://www.mux.com/docs/api-reference/data/dimensions/list-dimensions
- https://www.mux.com/docs/api-reference/data/dimensions/list-dimension-values
- https://www.mux.com/docs/api-reference/data/metrics
- https://www.mux.com/docs/api-reference/video/assets/list-assets
- https://www.mux.com/docs/core/make-api-requests
- https://ts.sdk.modelcontextprotocol.io/v2/

## Suggested first questions
1. "List recent Mux views and show me which fields are populated including viewer_user_id, asset_id, video_id, video_title, view_start, view_end and watch_time."
2. "For viewer_user_id <UUID>, list their Mux video views over the past 30 days, paginate if necessary, and show video titles and total playing time in minutes."
3. "Use Mux Data to aggregate total playing time by video_title over the last 7 days."
