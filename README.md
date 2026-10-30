<p align="center"><img src="https://raw.githubusercontent.com/zrob407/studio-bridge/main/assets/logo.png" width="128" alt="Studio Bridge logo"></p>

# Studio Bridge

An MCP server and Roblox Studio plugin that let an AI coding assistant such as Claude Code read and edit a place, run Luau, drive playtests, take screenshots and publish assets. Free to use, including for commercial games, under the Studio Bridge License (source-available, see License below); no dependencies beyond Node 22.

Studio Bridge speaks standard MCP, so it is not tied to one assistant. It is used and tested with Claude Code. Setup for OpenAI's Codex CLI is included (see Install), but it has not yet been tried with Codex itself.

## Quick start

```
npm install -g @zrob407/studio-bridge
studio-bridge install
```

Restart Claude Code and Roblox Studio, then allow HTTP requests and Script Injection for "Studio Bridge" if Studio asks. Run `studio-bridge doctor` if anything looks wrong. Windows, Node 22 or newer, Roblox Studio and Claude Code are required (Codex CLI setup is included but untested). Linux works through Wine and is untested; see the Linux section.

## Everyday time-savers

These are the things that take the most clicking by hand and the least time with Studio Bridge.

- **Publish assets in bulk.** `asset_publish_instances` exports many instances at once (for example every KeyframeSequence in a rig's AnimSaves folder) and uploads them all, named "{name} {rig}". `asset_upload_batch` uploads many files at once, skips anything already uploaded in the last 24 hours so an interrupted run resumes instead of duplicating, and writes the results to a file instead of flooding the chat. After re-uploading, `animation_ids` and `audio_manage` swap every old id in the place for the new one in a single call.
- **Audit the whole place in seconds.** `asset_audit` lists every asset id the place references and who owns each, so you find the ones that will break or that you do not own. `script_scan` ranks risky code (require by id, loadstring, obfuscation, DataStore, teleports), `script_dependencies` finds unused modules and `require(assetId)` calls, and `physics_report` and `audio_report` catch loose parts, void parts, missing sounds and duplicates.
- **Edit hundreds of things in one step.** `batch` runs up to 50 edits as one undo. `instance_bulk` sets, adjusts (add or multiply relative to the current value) or deletes across everything that matches a filter, with dry runs. `instance_rename`, `instance_duplicate` (rows, grids and circles of copies), `snap_grid` and `instance_pivot` replace a lot of dragging.
- **Build a world quickly.** `terrain` generates hills with a biome, water level and seed, then smooths, fills and recolors; `environment` switches lighting between day, sunset, night, fog and more; `scatter` drops trees, rocks or props across the ground with spacing, slope alignment and random scale; `spatial_find` finds flat spots, free space and spawn points; `spatial_check` tells you whether something floats or overlaps, what it touches, and how much of an area a character can walk on.
- **UI that fits every device.** `ui_build` makes a whole GUI from one description, `ui_autoscale` converts a pixel-based GUI to responsive Scale (respecting padding, anchors and layouts), and `ui_responsive_check` lays it out on real phones, tablets and consoles through Studio's device emulator and reports what runs off the screen, is too small to tap or has tiny text. `device_emulator` switches devices for screenshots.
- **Playtest without touching the keyboard.** `character_move` walks the character to a spot with pathfinding, `input_keyboard` and `input_mouse` send real key and mouse input, `gui_click` presses buttons by path, and `run_test` and screenshots report what happened.
- **Find and insert assets safely.** `asset_search` looks through the free Creator Store and `asset_insert` brings a model in after scanning it; scripts are removed unless you keep them, because free models can hide malicious code. `generate_model` makes a model from a text prompt using Roblox's own generation.
- **Animation without the editor.** `animation_create` builds keyframes from a description, `animation_edit` retimes, reverses and adds markers, `animation_play` previews it on a rig while you screenshot, and `animation_pose` freezes any frame.
- **Documentation at hand.** `roblox_docs` searches and reads the official Roblox documentation, so answers come from the current API reference.
- **Keep the AI's context small.** `studio-bridge settings tools core` offers only the 28 everyday tools and adds groups on demand (see Tool groups).

## What you can ask for

- "Export every animation in this rig's AnimSaves folder and publish them to my group."
- "Find every script that uses DataStore and list the risky ones."
- "List every asset this place uses that I do not own."
- "Generate a rocky island with a beach, scatter palm trees on it, and switch the lighting to sunset."
- "Build a main menu, make it responsive, and check it on an iPhone, an iPad and an Xbox."
- "Run a playtest, walk the character to the shop door, click Buy and tell me what errors show up."
- "Rename these 40 parts, space them out in a circle, and snap them to the grid."

Studio Bridge exposes seventy-nine tools, listed under Tools below. Roblox's own Studio MCP server is a separate server, so you can register both (they have not been tested together). As of this writing it has 26 tools centered on scripts, search, playtesting and generation; Studio Bridge adds terrain, lighting, spatial tools, animation and audio editing, UI scaling and device checks, bulk editing and publishing, audits and more.

## Why Studio Bridge

- **It does not time out and force a Studio restart.** Every command has a deadline and can be cancelled, results survive a reconnect, and the plugin reloads itself when it changes.
- **Fewer calls and tokens.** `batch` runs up to 50 edits in one call, the server instructions are a few hundred characters, and tool groups keep the tool list small.
- **It is easy to trust.** It listens only on `127.0.0.1`, needs a secret on every request, verifies the plugin's signature, collects no telemetry, and ships with build provenance.
- **Free for commercial games.** See License.

## Recently added

- Tool groups (`studio-bridge settings tools`), a Studio status window, and tokenless publishing to npm with provenance.
- Terrain, lighting presets, scatter, spatial and physics tools, effects, tweens.
- Animation authoring, editing and preview; audio management with preview.
- UI autoscale, responsive checks on real devices, and the device emulator.
- Playtest control: character movement, keyboard and mouse input.
- Asset search, safe insert and model generation; searchable Roblox documentation.
- Bulk editing, renaming and duplication; script dependency and audit tools.

## Install

Windows, Roblox Studio and Claude Code are required. Linux works through Wine (see the Linux section below).

**With npm (recommended).** Needs Node 22 or newer: `npm install -g @zrob407/studio-bridge`, then `studio-bridge install`. It runs on Node, which is signed by the OpenJS Foundation, so Windows protections such as Smart App Control do not block it the way they can block an unsigned exe. Data lives in `%LOCALAPPDATA%\StudioBridge` like the exe's, and `studio-bridge update` upgrades it through npm. The package is published on npm with build provenance, which `npm audit signatures` can verify.

**With the exe (no Node needed).** The exe is not code-signed, so Windows may warn about or block it (see Verifying a download); use npm or the source if that happens. Download `studio-bridge-<version>.exe` from the releases page and double-click it, or run `studio-bridge.exe install` in a terminal. It copies itself to `%LOCALAPPDATA%\StudioBridge`, creates a secret token, writes the Studio plugin, and registers itself with Claude Code (`claude mcp add --scope user`). Then restart Claude Code and Roblox Studio. If Studio asks, allow HTTP requests and Script Injection for "Studio Bridge".

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

To change a tool without rebuilding the exe, put a replacement file under `%LOCALAPPDATA%\StudioBridge\overrides` using the same relative path (for example `handlers\script_get.luau` or `tools.json`); it wins over the embedded copy.

To build the exe yourself: `npm ci` then `npm run build` (Windows, Node 24). The result is `dist\studio-bridge.exe`.

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

## The Studio Bridge window

The plugin adds a Studio Bridge button to the Plugins toolbar that opens a themed panel (it follows Studio's light or dark theme):

- **Status:** whether the bridge is connected and over which transport, how many commands have run and failed, the last command and how long ago it ran, and how long the plugin has been up.
- **Tools:** a summary of how many tools are offered and their approximate token cost, one-click presets (Everything, Essentials, World builder, UI designer, Animator, Publisher) and a switch for each tool group. Changes are saved to the bridge straight away; your AI client may need `/mcp` to refresh its tool list. If the profile is fixed by the `STUDIO_BRIDGE_TOOLS` environment variable, the switches are read-only.
- **Log:** a short log of connection events and commands.

## Linux

Roblox has no native Linux Studio, so this setup is for Studio running under Wine through [Vinegar](https://github.com/vinegarhq/vinegar) or Grapejuice. The bridge itself and Claude Code run natively on Linux; Studio reaches the bridge on `127.0.0.1` because Wine shares the host network.

1. Install Node 22 or newer, then `npm install -g @zrob407/studio-bridge` and `studio-bridge install`.
2. `install` looks for the Studio Wine prefix in `$WINEPREFIX`, Vinegar (Flatpak and native), Grapejuice and `~/.wine`, and writes the plugin into `drive_c/users/<user>/AppData/Local/Roblox/Plugins`. If your prefix is somewhere else, run it with `STUDIO_BRIDGE_PLUGINS_DIR` set to that `Plugins` folder.
3. Data (token, uploads, exports, settings) lives in `$XDG_DATA_HOME/studio-bridge`, usually `~/.local/share/studio-bridge`.
4. Start Studio from your launcher, allow HTTP requests and Script Injection for "Studio Bridge" if it asks, and run `studio-bridge doctor`.

Differences from Windows:

- The `screenshot` tool (a screen capture of the Studio window) works on Windows and on Hyprland, where it needs `grim`. `viewport_screenshot` captures the 3D view from inside Studio and works everywhere.
- `input_keyboard`, `input_mouse` and `gui_click` need Studio to be the focused window. On Hyprland (detected from `HYPRLAND_INSTANCE_SIGNATURE`) Studio Bridge finds the window with `hyprctl -j clients` and focuses it with `hyprctl dispatch focuswindow`. On other X11 desktops it uses `xdotool`. Elsewhere, click into Studio yourself before using those tools.
- The packaged exe is Windows only. Use the npm package.
- This path has not been tested on a real Linux machine yet. Reports are welcome.

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
- Building UI: `ui_build` (a whole GUI from one nested description), `ui_check` (layout checks in a running play session), `ui_autoscale` (convert a pixel-based GUI to responsive Scale: measures the real layout including UIPadding, AnchorPoint and SizeConstraint, leaves layout-managed, scrolling and automatic-size content alone, converts corner radii and list and grid spacing, makes text scale between a minimum and maximum, and adds aspect ratio and maximum size limits to top-level panels; `dryRun` previews, `designSize` scales against the screen size you designed for), `ui_responsive_check` (lay a GUI out at phone, tablet and desktop sizes without a playtest and report anything off-screen, too small to tap, tiny text or overflowing; with `emulator: true` it switches Studio to real devices such as iphone_14 or ipad_10th_generation for exact sizes and restores the emulator afterwards), `device_emulator` (list the roughly forty devices Studio can emulate, switch device, orientation or a custom resolution, and stop; screenshots then show the emulated screen)
- Instances: `instance_find`, `instance_children`, `instance_get`, `instance_set`, `instance_create`, `instance_delete`, `instance_move`, `instance_clone`, `selection_get`, `selection_set`
- World building: `terrain` (fill blocks, balls, cylinders and wedges; clear; read; smooth; replace a material; read and set material colors; generate noise terrain with a biome, height, water level and seed), `environment` (lighting presets day, sunset, night, overcast, foggy, horror and space, plus per-section overrides, a time of day, the sky and terrain water), `scatter` (drop copies of a model onto the ground with slope alignment, random spin and scale, minimum spacing and a seed), `tween_play` (preview a tween and restore the values)
- Animation: `animation_create` (build a KeyframeSequence from keyframes of poses keyed by part name, nested to match the rig's joints), `animation_edit` (scale or shift time, reverse, delete keyframes, add markers, set loop and priority; all or nothing, and it can edit a copy), `animation_inspect` (a sequence's length, joints, markers and poses, or every sequence under a container), `animation_pose` (pose a rig at a time in the animation so you can screenshot it, or reset it), `animation_play` (preview the animation on the rig in the background while you screenshot it), `animation_ids` (list, set and remap AnimationIds)
- Audio: `audio_manage` (list, create, bulk set properties or scale volume, SoundGroups, SoundEffects such as reverb and echo, preview play, pause and stop, and remap SoundIds), `audio_report`
- Placement and space: `spatial_find` (ground height, the flattest spots, free space for a box, and character spawn spots), `spatial_check` (does a model overlap, float or sit on a slope; what it touches; how much of an area is walkable), `spatial_map` (a top-down text map, or a scan of what is in a box), `snap_grid` (snap position and rotation to a grid), `physics_groups` (collision groups: register, set collidable, assign, list), `effects` (list, toggle, emit and clear particles, beams, trails and lights)
- Instances: `instance_duplicate` (arrays, grids and circles of copies), `instance_rename` (find and replace, prefix, suffix, case, numbering), `instance_pivot` (centre, base or top pivots), `instance_bulk` (get, set, adjust relative to the current value, or delete across many instances, with dry runs), `instance_info` (ancestors, an outline tree, and the members of a Roblox class), `script_dependencies` (follow require() between scripts, find unused modules, and spot require(assetId) calls)
- Playtest control: `character_move` (walk the player character to a position or an instance, using pathfinding around obstacles, jump, stop, and read its state), `input_keyboard` (key presses, holds and typed text), `input_mouse` (clicks, drags and holds at viewport pixels), all working through Studio's virtual input on a running playtest; these bring Studio to the front for the input
- Generation and reference: `generate_model` (a model from a text prompt, and optionally an image, using Roblox's own generation service in Studio), `roblox_docs` (search and read the official documentation on create.roblox.com)
- Asset library: `asset_search` (the free Creator Store: models, decals, audio, images, meshes, plugins), `asset_insert` (insert a free model by id; it scans the code first and removes scripts unless you keep them)
- Queries and checks: `raycast` (one ray or many), `spatial_query` (parts in a radius or box, nearest first, or the bounds of an instance), `tag_manage` (list, find, get, add and remove CollectionService tags), `physics_report` (loose, void, oversized and invisible-collidable parts), `audio_report` (missing, silent, loud and duplicated sounds)
- Playtests: `play_start`, `play_stop`, `run_test`, `logs_get`
- Camera and pictures: `camera_set`, `camera_frame`, `viewport_screenshot` (3D view only, works with the screen locked, can frame instances and restore your camera), `screenshot` (whole Studio window; needs an unlocked desktop)
- UI testing: `gui_snapshot`, `gui_click` (needs an unlocked desktop and Studio focus)
- Safety and transfer: `script_scan` (ranks risky code: require by id, loadstring, LoadAsset, obfuscation, HTTP, teleports, kicks, DataStore), `import_rbxm` (loads a saved .rbxm into the open place through a hidden holder, scans it first, and refuses high-risk code unless `block_high` is false; `scan_only` just inspects)
- Assets: `export_rbxm`, `asset_upload`, `asset_status`
- Auditing: `asset_audit` (every asset id a place references, plus who owns each; open the .rbxl in Studio first, then it reports yours, Roblox, Studio template, other owners and unavailable; keyless lookups, cached, resumable)
- Bulk publishing: `asset_publish_instances` (export many instances from Studio and upload them, named "{name} {rig}"), `asset_upload_batch` (many local files), `asset_batch_status` (finish checking a results file). Results go to a JSON file in `exports\`; identical files are reused for 24 hours so a rerun resumes instead of duplicating.

## Tool groups

All seventy-nine tools are offered by default. Their definitions cost roughly 23,000 tokens of context in a client that loads every tool at once, so you can offer fewer: `studio-bridge settings tools core` keeps just the 28 everyday tools (about 5,700 tokens), and a list adds groups to it, for example `studio-bridge settings tools building,ui`. The groups are `core` (always on: scripts, instances, selection, screenshots, camera, playtest start and stop, logs, batch and the docs), `building` (terrain, lighting, scatter, spatial tools, effects, tweens, collision groups, bulk editing, asset search and insert, generation), `ui` (building, scaling and checking GUIs, the device emulator), `playtest` (keyboard, mouse and character control), `media` (animation and audio), `publishing` (uploads, audits, exports) and `analysis` (script, physics and audio checks). `studio-bridge settings tools all` turns everything back on, and the `STUDIO_BRIDGE_TOOLS` environment variable overrides the setting. A running bridge picks the change up within a second or two; your AI client may need `/mcp` to refresh its list. A tool outside the chosen groups is not listed, cannot be batched, and says which group to enable if it is called anyway.

## Open Cloud key

Create `%USERPROFILE%\.roblox-key.txt` in your own terminal (no angle brackets): `Set-Content "$env:USERPROFILE\.roblox-key.txt" -Value 'YOUR_KEY' -NoNewline`. The key needs Assets read and write for the target creator. Revoke it when you are done. Uploads always need an explicit `creator_type` and `creator_id`.

## Known limits

- `loadstring` does not work inside a running game, so the plugin compiles code through a temporary ModuleScript there. Error line numbers are unchanged.
- Clicks come from the edit window's virtual input and only work while Studio is the focused window. `gui_click` focuses Studio for you.
- Playtests run the game for real. A game that touches live services can have real effects.
- Roblox's own asset guide says Animation uploads take `.rbxm` or `.rbxmx` (`model/x-rbxm`, 20 MB max), which is what the tool sends. Still not tried against the real API: an exported KeyframeSequence. Payloads up to about 5 MB raw went through Studio's HTTP without trouble. Files edited outside Studio may be rejected.

## Tests

`npm test` runs the sixteen suites in `test/`. They start the server with a random token and drive it with a fake plugin or the command line: queueing and timeouts, the WebSocket handshake, acknowledgements, reconnects, requeue limits and batch results, the tool list reload, the signed plugin endpoint, install and uninstall, the MCP handshake, the update command and the update notice, tool and auto-update, the official MCP client library talking to the server, and the npm package (packed, installed and run) with its update path. They need no Studio. `node test/cli.test.mjs dist/studio-bridge.exe` and `node test/serve.test.mjs dist/studio-bridge.exe` run the install and serve suites against a built exe.

## Security

This tool lets an AI assistant run arbitrary Luau inside your Studio, which is its purpose. Treat it like giving that assistant a console.

- The bridge listens only on `127.0.0.1`, rejects requests with a foreign `Host` header, and requires the random secret in `token.txt` on every request. The secret is created on install and never leaves your machine.
- The plugin loader only runs plugin source whose HMAC-SHA256 signature, keyed by that secret, matches. A different program that took over the port could not make Studio run its code without the secret.
- Nothing is sent anywhere except what you ask for: Roblox Open Cloud uploads (using a key you create), the public Roblox economy API for `asset_audit`, the public Creator Store search and economy details for `asset_search`, and the public documentation pages on create.roblox.com for `roblox_docs`. `generate_model` sends your prompt to Roblox's generation service through Studio.
- The Open Cloud key is read from `%USERPROFILE%\.roblox-key.txt` or `ROBLOX_API_KEY` and is never printed. Give it only the permissions you need and revoke it when you are done.
- `import_rbxm` and `script_scan` flag risky code (require by id, loadstring, LoadAsset, obfuscation, HTTP, teleports, kicks, DataStore) before it enters a place.
- Playtests run the game for real. A game that touches live services can have real effects.

Report vulnerabilities privately through the repository's security advisory page rather than a public issue.

## Privacy

The project collects no telemetry and has no accounts. Apart from `asset_search` and the audit, which only run when you ask, the one request it makes on its own is the once-a-day update check to GitHub's public releases API (your IP address is visible to GitHub, as with any request); turn it off with `studio-bridge settings check-updates off`. Files it writes stay on your computer: `token.txt`, upload and owner caches, and exported files under `exports\`. Do not commit or share those; the provided `.gitignore` excludes them.

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

This is not an OSI-approved open-source license, because it forbids selling the software. Versions 0.2.3 and earlier were released under the MIT License, and those copies stay available under it. The Node.js runtime inside the exe has its own license in `THIRD_PARTY_NOTICES.txt`; `studio-bridge licenses` prints both. This summary is not legal advice and the text in `LICENSE` is what applies.
