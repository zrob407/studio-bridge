# studio-bridge

An MCP server and Roblox Studio plugin that let an AI coding assistant such as Claude Code read and edit a place, run Luau, drive playtests, take screenshots and publish assets. MIT licensed, no dependencies beyond Node 22.

OpenAI support (for example Codex CLI) is coming soon. Studio Bridge speaks standard MCP, so it is not tied to one assistant; today it is set up and tested with Claude Code.

## Install

Windows, Roblox Studio and Claude Code are required.

**With the exe (no Node needed).** Download `studio-bridge-<version>.exe` from the releases page and double-click it, or run `studio-bridge.exe install` in a terminal. It copies itself to `%LOCALAPPDATA%StudioBridge`, creates a secret token, writes the Studio plugin, and registers itself with Claude Code (`claude mcp add --scope user`). Then restart Claude Code and Roblox Studio. If Studio asks, allow HTTP requests and Script Injection for "Studio Bridge".

**From source (Node 22 or newer).** Run `node cli.mjs install` in this folder. `node install.mjs` still works and does the same.

Other commands: `update` downloads the latest release, checks it against the release's `SHA256SUMS.txt` and installs it over the old one (`update --check` only reports; nothing is ever downloaded or replaced without you running `update`), `doctor` checks the installation and mentions when an update is available (`--offline` skips that), `uninstall` removes the plugin and the registration (`--purge` also deletes the data folder), `version` prints the version. `install --no-register` leaves the Claude Code configuration alone and prints the command to run yourself; `install --standalone` writes the full plugin instead of the self-updating loader.

To change a tool without rebuilding the exe, put a replacement file under `%LOCALAPPDATA%StudioBridgeoverrides` using the same relative path (for example `handlersscript_get.luau` or `tools.json`); it wins over the embedded copy.

To build the exe yourself: `npm ci` then `npm run build` (Windows, Node 24). The result is `diststudio-bridge.exe`.

## Pieces

- `server.mjs` is the MCP server (no dependencies, Node 22). It also runs a bridge on `127.0.0.1:3010` that the Studio plugin talks to, over a WebSocket (`/ws`, with acknowledgements and result replay after a reconnect) with HTTP long-polling as an automatic fallback. Every connection needs the secret in `token.txt`, and browser origins are refused.
- `plugin.stub.lua` is the small loader that `node install.mjs` fills in with the token and writes to `%LOCALAPPDATA%\Roblox\Plugins\Studio Bridge.rbxmx`. On start it asks the running bridge for `plugin.template.lua` (the real plugin), checks the source's HMAC-SHA256 signature (keyed by your token) and refuses to run anything that fails the check. While Studio is in edit mode it re-checks every 10 seconds and reloads the plugin when the file changes and no command is running, so plugin changes need no Studio restart. Restart Studio once after the first install. In Studio: Plugins > Manage Plugins, allow HTTP requests (and Script Injection) for Studio Bridge.
- `install --standalone` writes the full plugin instead of the loader, for people who do not want Studio to load code from the bridge. It does not update itself.
- `tools.json` lists every tool (name, description, input schema) plus a small `meta` section. The server watches it and tells the client the tool list changed, so edits show up without restarting the server; clients that ignore the notification pick them up on the next `/mcp` reconnect.
- `handlers/*.luau` are the Luau bodies of the tools. They are read on every call, so editing one needs no restart.

### Adding a tool

1. Write `handlers/<name>.luau`. The arguments arrive as the table `params`, and whatever the file returns is the result. Shared helpers such as `resolve`, `pathOf` and `requireScript` come from `handlers/_prelude.luau`.
2. Add an entry to `tools.json` with the same `name`, a short description and an input schema. A tool that has a handler file runs in the edit window by default and can be used inside `batch`.
3. Optional, in `meta`: `"role": "server"` or `"client"` to target a play-session window, and `"batchable": false` to keep it out of `batch`.

Tools that need server-side work (uploads, screenshots, the audit) are implemented in `server.mjs` and only have their schema in `tools.json`.
- `cli.mjs` is the command line (`serve`, `install`, `uninstall`, `doctor`, `version`) and the entry point of the exe. `paths.mjs` decides where files live: the data folder, the optional `overrides` folder, the files embedded in the exe, or the source checkout.
- `ws.mjs` is a small dependency-free WebSocket server layer.
- `assets.mjs` is the Open Cloud upload client.
- `screenshot.ps1` captures or focuses the Studio window.

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

`npm test` runs six suites in `test/`. They start the server with a random token and drive it with a fake plugin or the command line: queueing and timeouts, the WebSocket handshake, acknowledgements, reconnects, requeue limits and batch results, the tool list reload, the signed plugin endpoint, install and uninstall, and the MCP handshake. They need no Studio. `node test/cli.test.mjs dist/studio-bridge.exe` and `node test/serve.test.mjs dist/studio-bridge.exe` run the install and serve suites against a built exe.

## Security

This tool lets an AI assistant run arbitrary Luau inside your Studio, which is its purpose. Treat it like giving that assistant a console.

- The bridge listens only on `127.0.0.1`, rejects requests with a foreign `Host` header, and requires the random secret in `token.txt` on every request. The secret is created on install and never leaves your machine.
- The plugin loader only runs plugin source whose HMAC-SHA256 signature, keyed by that secret, matches. A different program that took over the port could not make Studio run its code without the secret.
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
