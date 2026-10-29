# studio-bridge

An MCP server and Roblox Studio plugin that let an AI coding assistant such as Claude Code read and edit a place, run Luau, drive playtests, take screenshots and publish assets. MIT licensed, no dependencies beyond Node 22.

## Pieces

- `server.mjs` is the MCP server (no dependencies, Node 22). It also runs a bridge on `127.0.0.1:3010` that the Studio plugin talks to, over a WebSocket (`/ws`, with acknowledgements and result replay after a reconnect) with HTTP long-polling as an automatic fallback. Every connection needs the secret in `token.txt`, and browser origins are refused.
- `plugin.template.lua` is the Studio plugin source. `node install.mjs` fills in the token and writes `%LOCALAPPDATA%\Roblox\Plugins\ClaudeStudioBridge.rbxmx`. Restart Studio after installing. In Studio: Plugins > Manage Plugins, allow HTTP requests (and Script Injection) for ClaudeStudioBridge.
- `handlers/*.luau` are the Luau bodies of the tools. They are read on every call, so editing one does not need a restart. A new tool or schema change needs a Claude Code restart.
- `ws.mjs` is a small dependency-free WebSocket server layer.
- `assets.mjs` is the Open Cloud upload client.
- `screenshot.ps1` captures or focuses the Studio window.

Install: run `node install.mjs` in this folder, then register with Claude Code once (the installer prints the exact command): `claude mcp add --scope user studio-bridge -- node "<full path to server.mjs>"`

## Windows

`studio_list` shows every connected window with a role:

- `edit`: the normal Studio window (default target)
- `server`: the running game server during a play session
- `client`: the player client. It cannot use HTTP itself, so commands reach it through a RemoteFunction relay in the server window. Pass `studio: "client"`.

When several windows are connected, pass `studio` as an id prefix, a placeId, part of the place name, or a role. Tokens are combined (for example `"Lure client"`).

## Tools

- Code: `run_luau`, `batch` (up to 50 edit-window tools in one call and one undo step)
- Scripts: `script_get`, `script_set`, `script_edit` (line numbers refer to the original script), `script_search`, `script_validate`
- Building UI: `ui_build` (a whole GUI from one nested description), `ui_check` (layout checks in a running play session)
- Instances: `instance_find`, `instance_children`, `instance_get`, `instance_set`, `instance_create`, `instance_delete`, `instance_move`, `instance_clone`, `selection_get`, `selection_set`
- Playtests: `play_start`, `play_stop`, `run_test`, `logs_get`
- Camera and pictures: `camera_set`, `camera_frame`, `viewport_screenshot` (3D view only, works with the screen locked, can frame instances and restore your camera), `screenshot` (whole Studio window; needs an unlocked desktop)
- UI testing: `gui_snapshot`, `gui_click` (needs an unlocked desktop and Studio focus)
- Safety and transfer: `script_scan` (ranks risky code: require by id, loadstring, LoadAsset, obfuscation, HTTP, teleports, kicks, DataStore), `import_rbxm` (loads a saved .rbxm into the open place through a hidden holder, scans it first, and refuses high-risk code unless `block_high` is false; `scan_only` just inspects)
- Assets: `export_rbxm`, `asset_upload`, `asset_status`
- Auditing: `asset_audit` (every asset id a place references, plus who owns each; open the .rbxl in Studio first, then it reports yours, Roblox, Studio template, other owners and unavailable; keyless lookups, cached, resumable)
- Bulk publishing: `asset_publish_instances` (export many instances from Studio and upload them, named "{name} {rig}"), `asset_upload_batch` (many local files), `asset_batch_status` (finish checking a results file). Results go to a JSON file in `exports\`; identical files are reused for 24 hours so a rerun resumes instead of duplicating.

## Open Cloud key

Create `%USERPROFILE%\.roblox-key.txt` in your own terminal (no angle brackets): `Set-Content "$env:USERPROFILE\.roblox-key.txt" -Value 'YOUR_KEY' -NoNewline`. The key needs Assets read and write for the target creator. Revoke it when you are done. Uploads always need an explicit `creator_type` and `creator_id`.

## Known limits

- `loadstring` does not work inside a running game, so the plugin compiles code through a temporary ModuleScript there. Error line numbers are unchanged.
- Clicks come from the edit window's virtual input and only work while Studio is the focused window. `gui_click` focuses Studio for you.
- Playtests run the game for real. A game that touches live services can have real effects.
- Roblox's own asset guide says Animation uploads take `.rbxm` or `.rbxmx` (`model/x-rbxm`, 20 MB max), which is what the tool sends. Still not tried against the real API: an exported KeyframeSequence. Payloads up to about 5 MB raw went through Studio's HTTP without trouble. Files edited outside Studio may be rejected.

## Tests

`node test/reliability.test.mjs` and `node test/ws-transport.test.mjs` start the server with a random token and drive it with a fake plugin: queueing and timeouts, the WebSocket handshake, acknowledgements, reconnects, requeue limits and batch results. They need no Studio and take under a minute each.

## Security

This tool lets an AI assistant run arbitrary Luau inside your Studio, which is its purpose. Treat it like giving that assistant a console.

- The bridge listens only on `127.0.0.1`, rejects requests with a foreign `Host` header, and requires the random secret in `token.txt` on every request. The secret is created on install and never leaves your machine.
- Nothing is sent anywhere except what you ask for: Roblox Open Cloud uploads (using a key you create) and the public Roblox economy API for `asset_audit`.
- The Open Cloud key is read from `%USERPROFILE%\.roblox-key.txt` or `ROBLOX_API_KEY` and is never printed. Give it only the permissions you need and revoke it when you are done.
- `import_rbxm` and `script_scan` flag risky code (require by id, loadstring, LoadAsset, obfuscation, HTTP, teleports, kicks, DataStore) before it enters a place.
- Playtests run the game for real. A game that touches live services can have real effects.

Report vulnerabilities privately through the repository's security advisory page rather than a public issue.

## Privacy

The project collects no telemetry and has no accounts. Files it writes stay on your computer: `token.txt`, upload and owner caches, and exported files under `exports\`. Do not commit or share those; the provided `.gitignore` excludes them.

## Code signing policy

Release builds are produced by the GitHub Actions workflow in `.github/workflows/release.yml` from the tagged source in this repository. Each release publishes a `SHA256SUMS.txt` and a GitHub build attestation, so you can check that a download was built from this source:

`gh attestation verify <downloaded file> --repo <owner>/<repository>`

If Windows executables are signed for this project, the signing policy will be listed here with the signing provider's attribution, the team roles (committers and reviewers, approvers) and the privacy statement above. Until then, release files are unsigned and Windows SmartScreen may warn on first run.

## License

MIT, see `LICENSE`.
