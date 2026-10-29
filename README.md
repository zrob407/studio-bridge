# studio-bridge

An MCP server and Roblox Studio plugin that let an AI coding assistant such as Claude Code read and edit a place, run Luau, drive playtests, take screenshots and publish assets. Free to use, including for commercial games, under the Studio Bridge License (source-available, see License below); no dependencies beyond Node 22.

Studio Bridge speaks standard MCP, so it is not tied to one assistant. It is used and tested with Claude Code. Setup for OpenAI's Codex CLI is included (see Install), but it has not yet been tried with Codex itself.

## Install

Windows, Roblox Studio and Claude Code are required.

**With npm (recommended).** Needs Node 22 or newer: `npm install -g @zrob407/studio-bridge`, then `studio-bridge install`. It runs on Node, which is signed by the OpenJS Foundation, so Windows protections such as Smart App Control do not block it the way they can block an unsigned exe. Data lives in `%LOCALAPPDATA%\StudioBridge` like the exe's, and `studio-bridge update` upgrades it through npm. The package is published on npm with build provenance, which `npm audit signatures` can verify.

**With the exe (no Node needed).** The exe is not code-signed, so Windows may warn about or block it (see Verifying a download); use npm or the source if that happens. Download `studio-bridge-<version>.exe` from the releases page and double-click it, or run `studio-bridge.exe install` in a terminal. It copies itself to `%LOCALAPPDATA%StudioBridge`, creates a secret token, writes the Studio plugin, and registers itself with Claude Code (`claude mcp add --scope user`). Then restart Claude Code and Roblox Studio. If Studio asks, allow HTTP requests and Script Injection for "Studio Bridge".

If an earlier source install is registered with Claude Code (`node server.mjs`), the installer finds it, switches the registration to the exe, reuses its token (so an open Studio window keeps working) and copies over `uploads.json` and `asset-owners.json` if the new location has none. It never overwrites existing files and leaves the old folder alone; `--migrate-from <folder>` does the same for a folder you point it at. Old plugin files such as `ClaudeStudioBridge.rbxmx` are removed so only one copy loads.

**From source (Node 22 or newer).** Run `node cli.mjs install` in this folder. `node install.mjs` still works and does the same.

**With OpenAI Codex CLI.** `studio-bridge install --client codex` (or `--client all` for Claude Code and Codex) adds a `[mcp_servers.studio-bridge]` entry to `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`), keeping everything else in that file, with a 30-second startup timeout and a 600-second tool timeout; Codex's default tool timeout is 60 seconds, which would cut off playtests and large asset batches. Restart Codex afterwards. To add it by hand:

```toml
[mcp_servers.studio-bridge]
command = "C:\\Users\\you\\AppData\\Local\\StudioBridge\\studio-bridge.exe"
args = ["serve"]
startup_timeout_sec = 30
tool_timeout_sec = 600
```

The setup follows the configuration format in OpenAI's published Codex documentation. The test suite checks the server against the official MCP client library, and `doctor` reports a Codex registration. If something does not work with Codex, please open an issue.

Only one bridge runs at a time, because it owns port 3010 and the Studio plugin connects to that port. When you upgrade, a newer server that finds an older one still running asks it to stop (using the shared token) and takes over the port, so you do not have to end the old process by hand. A server of the same version, or an older one, never replaces another. That also means two AI clients, for example Claude Code and Codex, cannot use the bridge at the same time: the second one to start finds the port busy and stops with a message.

Other commands: `update` downloads the latest release, checks it against the release's `SHA256SUMS.txt` and installs it over the old one (`update --check` only reports), `doctor` checks the installation and mentions when an update is available (`--offline` skips that), `uninstall` removes the plugin and the registration (`--purge` also deletes the data folder), `version` prints the version. `install --no-register` leaves the Claude Code configuration alone and prints the command to run yourself; `install --standalone` writes the full plugin instead of the self-updating loader.

To change a tool without rebuilding the exe, put a replacement file under `%LOCALAPPDATA%StudioBridgeoverrides` using the same relative path (for example `handlersscript_get.luau` or `tools.json`); it wins over the embedded copy.

To build the exe yourself: `npm ci` then `npm run build` (Windows, Node 24). The result is `diststudio-bridge.exe`.

## Updates

Three layers, from least to most automatic. Only the first two are on by default.

1. **A notice.** When the bridge starts it asks GitHub for the latest release, at most once a day, and `studio_list` then mentions an available update. Nothing is downloaded. Turn it off with `studio-bridge settings check-updates off`.
2. **Update on request.** Tell Claude to update Studio Bridge. The `bridge_update` tool reports the new version first and only downloads, verifies and installs it when it is called with `confirm: true`, which Claude should do only after you agree. You then run `/mcp`. You can also run `studio-bridge update` yourself.
3. **Auto-update (off by default).** `studio-bridge settings auto-update on` makes the bridge download, verify and install new releases on its own when it starts; they take effect at the next restart and are logged in `update-log.txt` in the data folder. Because this replaces the program without asking, it is opt-in; the checksum is verified first, but releases are not code-signed.

Every download is checked against the `SHA256SUMS.txt` published with the release before anything is replaced, and downloads are only accepted from GitHub. `studio-bridge settings` shows the current choices.

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

- Maintenance: `bridge_update` (reports a newer release; installs it only when called with `confirm: true`)
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

`npm test` runs the thirteen suites in `test/`. They start the server with a random token and drive it with a fake plugin or the command line: queueing and timeouts, the WebSocket handshake, acknowledgements, reconnects, requeue limits and batch results, the tool list reload, the signed plugin endpoint, install and uninstall, the MCP handshake, the update command and the update notice, tool and auto-update, the official MCP client library talking to the server, and the npm package (packed, installed and run) with its update path. They need no Studio. `node test/cli.test.mjs dist/studio-bridge.exe` and `node test/serve.test.mjs dist/studio-bridge.exe` run the install and serve suites against a built exe.

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

The project collects no telemetry and has no accounts. The one request it makes on its own is the once-a-day update check to GitHub's public releases API (your IP address is visible to GitHub, as with any request); turn it off with `studio-bridge settings check-updates off`. Files it writes stay on your computer: `token.txt`, upload and owner caches, and exported files under `exports\`. Do not commit or share those; the provided `.gitignore` excludes them.

## Verifying a download

Release builds are produced by the GitHub Actions workflow in `.github/workflows/release.yml` from the tagged source in this repository. Each release publishes a `SHA256SUMS.txt` and a GitHub build attestation, so you can check that a download was built from this source:

`gh attestation verify <downloaded file> --repo <owner>/<repository>`

The exe is not code-signed. If you download it in a browser, Windows SmartScreen may show "Windows protected your PC": choose "More info" and then "Run anyway" after checking the checksum. Files fetched by `studio-bridge update`, the `bridge_update` tool or command-line tools such as `gh` do not normally carry that browser mark.

## License

Studio Bridge is source-available under the Studio Bridge License in `LICENSE`. In plain terms:

- You may use, copy, modify and share it for free, and use it to make anything you like, including commercial games.
- You must keep the copyright notice and license, and you must not present it, or a modified version, as your own original work.
- You may not sell it, or charge for copies of it or for a product or service whose value comes mainly from it (a paid fork, a paid hosted version, selling the exe).
- Forks should not use the name "Studio Bridge" in a way that suggests they are the original or endorsed by the author.
- The core stays free. The author may also offer separate add-ons or services, possibly for a fee, under separate terms; those are not covered by this license, and versions already released stay available under the terms they were released with.

Each copy checks that its `LICENSE` file is unmodified (line endings and trailing spaces are ignored). If it was changed or removed, Studio Bridge stays up only to say so: the MCP server tells the AI client "Tampering detected" and returns that message from every tool call, it refuses to serve the plugin or accept plugin connections, and `install` and `update` refuse to run. Restoring the original `LICENSE` lifts the lock at once, and `doctor`, `version` and `licenses` keep working. See License integrity check below.

This is not an OSI-approved open-source license, because it forbids selling the software. Versions 0.2.3 and earlier were released under the MIT License, and those copies stay available under it. The Node.js runtime inside the exe has its own license in `THIRD_PARTY_NOTICES.txt`; `studio-bridge licenses` prints both. This summary is not legal advice and the text in `LICENSE` is what applies.

### License integrity check

Every version carries a hash of its own `LICENSE` text. If the file in a copy no longer matches (edited, emptied or deleted), the server switches to a locked mode: it still answers, but only to say "Tampering detected: any further use of a tampered license of this tool is not allowed", through the MCP server instructions and as the result of every tool call, so the AI assistant passes that on to the user. The plugin is not served and cannot connect, and `install` and `update` refuse to run. Putting the original `LICENSE` back lifts the lock without a restart. `studio-bridge licenses --hash` prints the hash a maintainer needs to update when the license text changes.

This is a safeguard against casual tampering, not copy protection: the source is public, so anyone determined can remove the check, and the license text is what actually binds you. An earlier build of this check was taken out for a few days while an unrelated Windows block on the unsigned exe was being investigated; the check was not the cause, and it is back now that Studio Bridge can also be installed from npm.
