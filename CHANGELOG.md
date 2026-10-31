# Changelog

All notable changes to Studio Bridge. Newest first. Versions that were tagged but never published as a release are folded into the next one.

## Unreleased

- Tabs, preset chips, switches and buttons grow and light up when you point at them.

## 0.6.10 - 2026-10-31

- New **Config** tab in the Studio Bridge window: switch update checks, automatic updates and signed-packs-only on or off without asking your AI or using the command line. It also shows the current tool groups with a shortcut to the Tools tab. Needs the matching Studio Bridge program, so restart your AI tool after updating.
- When the port is already taken, `serve` now says what holds it (which Studio Bridge version, or another program) and how to find and stop it, instead of just failing. `doctor` says the same instead of a generic 401 warning, and `install` warns when an older server is still running. A running server now includes its version in the reply to an unauthorized request.
- `doctor` no longer reports a failure for a plugin folder that is missing the plugin when another Studio plugin folder it checks has it (Linux with Vinegar writes to both).

## 0.6.8 - 2026-10-31

- Added a project website at https://zrob407.github.io/studio-bridge/ with install steps, a searchable tool list, a comparison with other Roblox Studio MCP tools, Studio Bridge Pro and this changelog.
- The **Buy a license** button now explains when the running Studio Bridge program is older than the plugin, and tells you to restart your AI tool, instead of saying it could not be reached.

## 0.6.7 - 2026-10-31

### Added
- **Studio Bridge Pro**: optional paid add-on packs. The first, Snapshots and diffs, saves part of a place, shows exactly what changed since, and rolls it back with an automatic safety snapshot first. The free program is unchanged. Pro has its own separate license in `PRO-LICENSE.txt`.
- A **Pro** tab in the Studio Bridge window: paste a license key, press Activate, and the packs download automatically. A **Buy a license** button opens the checkout page.
- `studio-bridge pro activate`, `pro status` and `pro remove`.
- Packs are digitally signed in two tiers, free official and paid Pro. Unsigned third-party packs still load and are labeled as unverified. `studio-bridge settings pack-trust verified` loads only signed packs. A PRO or unverified badge shows on each pack's tool group, and `doctor` lists every pack.

### Changed
- The window screenshot tool is no longer offered where it cannot work (Linux without Hyprland, macOS), which also trims the tool list there.
- A settings file that cannot be read now falls back to loading only signed packs, and a copy of the broken file is kept instead of being overwritten.
- Pack timeouts are capped like every other tool.

### Fixed
- `pro remove` now exits with an error code when it fails.
- The release source zip now includes every program file.

## 0.6.6 - 2026-10-30

- Linux: the plugin is written to Vinegar's app data folder and to the Wine prefix, so Studio finds it either way.
- Added `npm run test:changed`, which runs only the tests affected by your changes.

## 0.6.5 - 2026-10-30

- Linux: the plugin goes into Vinegar's app data plugin folder.
- `doctor` now checks that Studio Bridge is registered with your AI tool.

## 0.6.4 - 2026-10-30

- Linux support through Wine (Vinegar and Grapejuice). This includes the work from 0.6.3, which was tagged but never published.
- Hyprland support: Studio Bridge focuses the Studio window with `hyprctl` and takes window screenshots with `grim`.

## 0.6.2 - 2026-10-30

- The Studio Bridge window was redone with themed tabs, tool group presets, and switches that are saved to the bridge.
- The exe now has the Studio Bridge icon.
- Files the bridge writes when run from source are no longer tracked.

## 0.6.1 - 2026-10-30

- Added a logo and gave the Studio toolbar button its icon.
- Rewrote the top of the README with everyday time-savers and what is new.

## 0.6.0 - 2026-10-30

- **Tool groups**: clients can load only the tools they need. `studio-bridge settings tools core` offers just the 28 everyday tools and keeps the tool list small.

## 0.5.0 - 2026-10-30

- Playtest control: character movement with pathfinding, plus keyboard and mouse input.
- `generate_model` makes a model from a text prompt.
- `roblox_docs` searches and reads the official Roblox documentation.

## 0.4.1 - 2026-10-30

- Releases are now published to npm with Trusted Publishing and build provenance.
- Trimmed the README license section.

## 0.4.0 - 2026-10-30

- New tools for terrain, lighting and environment presets, scatter, raycasts, spatial queries, tags, tweens, physics groups and reports, audio, effects, assets, instances and scripts.
- Animation authoring, editing and preview, and audio management.
- `ui_autoscale`, `ui_responsive_check` and `device_emulator` to build GUIs that fit every device.
- A Studio status window.
- Fixes from a full review: a scan guard, release file lists, a tween timeout, probe cleanup, PrimaryPart pivots, design sizes, per-joint animation blending, typed bulk adjust, name escaping and scatter.

## 0.3.5 - 2026-10-30

- Internal maintenance.

## 0.3.4 - 2026-10-30

- Added a quick start, issue templates and npm keywords, and fixed backslashes that were dropped from paths in the README.

## 0.3.3 - 2026-10-29

- A newer Studio Bridge server can now take over the port from an older one.

## 0.3.2 - 2026-10-29

- Maintenance release. It includes the unpublished 0.3.1.

## 0.3.0 - 2026-10-29

- **npm package**: install with `npm install -g @zrob407/studio-bridge`. It runs on Node, which Windows does not block the way it can block an unsigned exe.
- **OpenAI Codex CLI** setup is included, with a conformance test. It has not been tried against Codex itself.
- An old source install is carried over instead of starting from scratch.
- Future releases moved to the Studio Bridge License (source-available, free for commercial games). Versions 0.2.3 and earlier stay available under the MIT License. The license also states that separate paid add-ons may exist.

## 0.2.3 - 2026-10-29

- An update notice, a `bridge_update` tool, and opt-in auto-update.

## 0.2.2 - 2026-10-29

- Fixed updating over a running exe that had a stale leftover copy.

## 0.2.1 - 2026-10-29

- The release workflow now uses Node 24 action versions.

## 0.2.0 - 2026-10-29

First public release.

- An MCP server and a Roblox Studio plugin that run commands inside Studio.
- Every command runs in its own thread with a deadline, and results are retried so they survive a reconnect.
- A `batch` tool that runs many edits in one call, with a WebSocket transport and an HTTP fallback.
- A signed, hot-reloading plugin loader, and the plugin loads in play clients through the play server.
- A single-file exe with a command line and an installer, plus an `update` command and update notice.
- Tool definitions live in `tools.json`, and `doctor` checks the setup.
- The server exits with a clear error when its port is already in use.
