# Mux MCP v2

Open-source-friendly **Mux Data + Mux Video** MCP server for Node.js. Works with Claude Desktop and other local-stdio MCP clients. **Read-only by default**, with separately gated asset metadata, subtitle-track and playback-ID changes. No video uploads, new asset creation, new live stream creation, or generic API-request tool.

> This is an independent community project. Not affiliated with or endorsed by Mux. Mux also offers its own official MCP service and package. This project is intentionally focused on explicit operations and conservative permissions.

## Requirements

- Node.js **20.10 or newer** (Node 22 LTS recommended)
- An MCP client that launches local stdio servers, e.g. Claude Desktop
- A Mux token with **Data Read** and (for asset tools) **Video Read**
- For write tools, a **separate** Mux token with **Video Write** (and ensure the read token also has Video Read for preflight checks)

## Install / upgrade from v1

1. Back up your Git branch or create a feature branch. Copy the files from this ZIP into the root of your existing `mux-mcp` repository.
2. The new entrypoint remains **`server.mjs`**, so your existing Claude MCP configuration does not need a path change.
3. The original `server-paths.mjs` and `test.mjs` are no longer used and can be removed from Git.
4. Run:

```bash
npm install
npm run check
npm test
```

To test with real Mux data, supply read-only credentials to your local process, restart Claude, and ask it to call `mux_server_capabilities`, `mux_list_dimensions`, and `mux_list_assets`. Live Mux connectivity is **not** covered by unit tests.

### Keep the existing Claude configuration

If you already configured Claude Desktop to run `node /ABSOLUTE/PATH/mux-mcp/server.mjs` with `MUX_TOKEN_ID` and `MUX_TOKEN_SECRET` in its `env`, it will work for the v2 read tools without any change.

Example configuration for a **read-only** client:

```json
{
  "mcpServers": {
    "mux-mcp": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/mux-mcp/server.mjs"],
      "env": {
        "MUX_ACCESS_MODE": "readonly",
        "MUX_TOKEN_ID": "YOUR_READ_TOKEN_ID",
        "MUX_TOKEN_SECRET": "YOUR_READ_TOKEN_SECRET"
      }
    }
  }
}
```

**Windows:** use an absolute path with forward slashes (`C:/Users/.../mux-mcp/server.mjs`) or double-backslashes in JSON. Preserve your other existing MCP servers by **merging** into the existing `mcpServers` object.

### Configure via `.env` (optional)

Copy `.env.example` to `.env` and enter secrets **on your own computer**. On Node 20.10+ you can launch using:

```bash
node --env-file=.env server.mjs
```

For Claude Desktop, use `"args": ["--env-file=/ABSOLUTE/PATH/TO/mux-mcp/.env", "/ABSOLUTE/PATH/TO/mux-mcp/server.mjs"]` and keep `"command": "node"`. `npm run start:env` works from the project directory.

**Never commit `.env`, API keys, session transcripts, or Claude's config file.** `.gitignore` protects common secret files, but always inspect `git diff --cached` before pushing.

## Permission model

| Mode | Registered tools | Credentials | Operations |
| --- | --- | --- | --- |
| `readonly` (default) | 32 | Mux read token | Analytics, monitoring, asset inspection, audits |
| `write` | 36 | Read token + **separate** Mux Video write token | Above + metadata edit, text track create/update, new playback ID |
| `admin` | Up to 39 | Same as write, with delete flags | Above + specifically enabled, individually approved deletions |

Settings are read from the **process environment when Claude starts**. Restart Claude after changes. Unknown or absent `MUX_ACCESS_MODE` always falls back to `readonly`. Do not assume UI annotations enforce permissions; the HTTP client and permission checks also enforce them.

To enable metadata and subtitle writes, set these environment variables:

```dotenv
MUX_ACCESS_MODE=write
MUX_WRITE_TOKEN_ID=...
MUX_WRITE_TOKEN_SECRET=...
```

To additionally enable selected deletion operations:

```dotenv
MUX_ACCESS_MODE=admin
MUX_ENABLE_ASSET_DELETE=false
MUX_ENABLE_TRACK_DELETE=false
MUX_ENABLE_PLAYBACK_ID_DELETE=false
```

Set **only** the deletion flags you actually want to `true`; all default to false. A valid, separately privileged write token is also mandatory.

### Local operator approval for deletion

Even with `admin` enabled, the MCP cannot delete anything until a person runs a **separate interactive command on the machine running the server**. For example:

```bash
# Start this from an actual terminal, not a pipe or automation:
npm run approve-delete -- asset YOUR_MUX_ASSET_ID
npm run approve-delete -- track YOUR_MUX_ASSET_ID YOUR_TRACK_ID
npm run approve-delete -- playback_id YOUR_MUX_ASSET_ID YOUR_PLAYBACK_ID
```

The command displays the exact target. Enter the `DELETE ...` phrase exactly. An approval applies to **one exact target**, can be consumed **once**, and expires after **2 minutes**. Then tell Claude to call the corresponding `mux_delete_*` tool. The approval record is kept in a private directory under your OS home directory, not in the repository.

**Security boundary:** This is strong protection against ordinary MCP tool-calling mistakes, **not** a guarantee against a malicious AI agent that also has unrestricted shell access to the same user account, or against other local malware. Don't grant your AI unrestricted local command execution for high-stakes administration. For a public multi-user deployment you must replace local approval files with authenticated, per-user server-side authorization/audit infrastructure, not just expose this stdio server over HTTP.

### Playback ID policy

New playback IDs default to `signed`. Creating public playback IDs can change who can access content, so public IDs require the **separate** `MUX_ENABLE_PUBLIC_PLAYBACK_ID=true` flag (and `write` mode). Existing playback IDs can be inspected in read mode. Revoking one is treated as destructive, with its own admin flag and approval.

## Tools

### Original nine names (preserved)

- `mux_list_video_views`, `mux_get_video_view`, `mux_list_dimensions`, `mux_dimension_values`
- `mux_metric_overall`, `mux_metric_breakdown`, `mux_metric_timeseries`
- `mux_list_assets`, `mux_get_asset`

`mux_get_video_view` now defaults to `response_mode="summary"` so huge event arrays don't flood the AI context. Choose `response_mode="full"` to fetch complete playback events. Signed URL tokens and keys are redacted from tool output.

### Additional read tools (23)

- `mux_server_capabilities`: report current mode and enabled operations (never credentials).
- `mux_list_filters`, `mux_filter_values`, `mux_list_errors`, `mux_metric_insights`, `mux_metric_comparison`
- `mux_list_monitoring_dimensions`, `mux_list_monitoring_metrics`, `mux_monitoring_timeseries`, `mux_monitoring_breakdown`
- `mux_engagement`: historical engagement heatmaps and hotspots by asset/video/playback ID
- `mux_list_asset_tracks`, `mux_get_asset_input_info`, `mux_get_asset_playback_id`, `mux_lookup_playback_id`
- `mux_list_live_streams`, `mux_get_live_stream`, `mux_list_playback_restrictions`, `mux_get_playback_restriction`
- `mux_audit_asset_metadata`, `mux_find_assets_without_subtitles`: bounded scans (up to five pages) and **not** entire-account audits unless the scanned assets cover the whole account
- `mux_compare_metric_periods`, `mux_analytics_summary`: deterministic higher-level analytics helpers

Some endpoints require Mux Video Read scope or plan-specific Mux Data features. `403` or `404` from Mux does not necessarily mean the MCP is incorrectly configured; it can mean your token, account plan or selected metric lacks the feature.

### Write tools (4; disabled by default)

- `mux_update_asset_metadata`: updates `meta.title`, `meta.creator_id`, `meta.external_id`, `passthrough`, `thumbnail_time`; preserves unspecified existing metadata.
- `mux_create_subtitle_track`: adds a text subtitle/chapters track from a public HTTPS SRT/WebVTT URL. Does **not** upload or host subtitle files.
- `mux_update_asset_track`: changes language, name, captions flag and passthrough of compatible existing tracks.
- `mux_create_asset_playback_id`: adds a **signed** playback ID, or a public one if separately enabled.

Metadata may be surfaced publicly through Mux players; **do not put secrets or personally identifiable information into asset metadata**.

### Delete tools (3; disabled by default)

- `mux_delete_asset`: permanent removal of video and its data
- `mux_delete_asset_track`: removal of text or non-primary audio tracks
- `mux_delete_asset_playback_id`: revoke playback access

All require `admin` mode, separate write credentials, action-specific flag, and a fresh local single-use operator approval.

## Notes and limits

- **No production-Mux changes were made in development.** Unit tests simulate Mux responses; they do not prove all endpoint/plan combinations work with your Mux account. Test first with a disposable asset and limited credentials.
- Mux Data metrics may use different aggregation populations and start/end time bucketing; don't assume raw view counts match all metric totals. Times are UTC Unix seconds; some Mux duration fields are milliseconds.
- Mux asset playback IDs are distinct from asset IDs; `viewer_user_id` is an application-supplied viewer identifier, not Mux's generated `viewer_id`.
- Requests go to a fixed `https://api.mux.com` origin through explicit endpoint/method allowlists. Mutations aren't auto-retried. GET retries only retryable HTTP statuses.
- Response output is capped and arrays are bounded. For large accounts, paginate or narrow your filters.
- Secrets and signed URL query parameters are redacted on a best-effort basis, but tool responses can still contain sensitive viewer data. Configure sharing and privacy appropriately.
- This release exposes a **local stdio** server, not a public hosted MCP service. Publishing to GitHub does not deploy a remote server.

## Develop and push to GitHub

```bash
git checkout -b feat/mux-mcp-v2
# Copy these new files into your existing repo; remove obsolete server-paths.mjs and test.mjs
git add .
git diff --cached --stat
git diff --cached  # VERIFY NO SECRETS BEFORE PUSH
npm install
npm run check
npm test
git commit -m "feat: Mux MCP v2 with guarded write and delete capabilities"
git push -u origin feat/mux-mcp-v2
```

Open a pull request into `main`, review it, and merge when verified. If `npm install` creates `package-lock.json`, commit it for reproducible installs (`npm ci` for collaborators). The repository intentionally keeps the project's `server.mjs` root entry point stable.

## Verified references (October 2026)

- [Mux Data metrics and monitoring](https://www.mux.com/docs/api-reference/data/metrics)
- [Mux Video assets](https://www.mux.com/docs/api-reference/video/assets)
- [Update an asset](https://www.mux.com/docs/api-reference/video/assets/update-asset)
- [Create an asset track](https://www.mux.com/docs/api-reference/video/assets/create-asset-track)
- [Update an asset track](https://www.mux.com/docs/api-reference/video/assets/update-asset-track)
- [Delete an asset track](https://www.mux.com/docs/api-reference/video/assets/delete-asset-track)
- [Delete an asset](https://www.mux.com/docs/api-reference/video/assets/delete-asset)
- [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)

## License

MIT. See `LICENSE`.
