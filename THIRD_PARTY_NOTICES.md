# Third-party notices

## Lucide icons

The git and path icons in `src/icons.ts` come from [Lucide](https://lucide.dev) (folder, file-text, copy, git-branch, cloud-off, unlink, archive).

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without
fee is hereby granted, provided that the above copyright notice and this permission notice appear
in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE
OF THIS SOFTWARE.
```

## Window frame (Frond)

The window frame in `src/shell/` (title bar, side panel, column resizing, menus, dialogs, banner,
status bar, themes, settings popup, shortcuts), its line icons (`src/shell/icons.ts` and the
caption and side panel icons in `index.html`) and parts of `src/settings.ts` were adapted from
https://github.com/cyKim0115/Frond/ @99d89bc, MIT License, same author as this app. Per-file sources
and changes are listed in `src/shell/SOURCES.md`. The Frond name and app icon are not used.

The app icon (`app-icon.png`, `src-tauri/icons/`) was drawn for this app (`scripts/draw_app_icon.py`).

## Libraries

The app is built with [Tauri](https://tauri.app) (MIT or Apache-2.0) and the Rust crates and npm
packages listed in `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `package.json` and
`package-lock.json`, each under its own license. Among them:

| Package | License | Use |
|---|---|---|
| `tauri-plugin-window-state` | MIT or Apache-2.0 | remembers window position and size |
| `tauri-plugin-single-instance` | MIT or Apache-2.0 | a second launch brings the running window forward |
| `vitest` | MIT | unit tests (development only, not shipped) |
| `jsdom` | MIT | DOM for the unit tests (development only, not shipped) |
