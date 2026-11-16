# src/shell sources

The app frame in this folder was copied from the author's Frond app and changed for this app:
https://github.com/cyKim0115/Frond/ at commit `99d89bc` (MIT License, same author). Each file names its
source in its header comment. The Frond name and app icon are not used here (Frond's TRADEMARKS.md);
the line icons in `index.html` and `icons.ts` are plain SVG paths.

| File here | Frond source | Changes |
|---|---|---|
| `titlebar.ts` | `src/titlebar.ts` | Caption labels from i18n, `relabel()` for a language change, no-op in the browser preview, `select` also skips dragging |
| `resize.ts`, `resize.test.ts` | `src/resize.ts`, `src/resize.test.ts` | Sizes the details column on the right (the handle is on its left edge, so moving left widens it) instead of the table of contents; default 420, minimum 300, at most 60% of the room; `aria-valuemin`/`aria-valuemax`; window resize keeps the cap |
| `context-menu.ts` | `src/context-menu.ts` | Separators, disabled and danger items, checkbox items (`menuitemcheckbox`, `aria-checked`), shortcut labels, open at a point or under/above a button, Home/End |
| `dialog.ts` | `src/dialog.ts` | Default button label from i18n, `isDialogOpen()` |
| `prefs.ts`, `prefs.test.ts` | `src/prefs.ts`, `src/prefs.test.ts` | Prefix `unity-slot-widget.`; the old-prefix migration is left out; tests rewritten for this prefix |
| `nav.ts` | `src/nav.ts` | Recent files, the file opener and the dialogs are left out; tab badges with a level; ←/→/Home/End between tabs; an outside press closes the panel when it opens over the list |
| `keys.ts`, `keys.test.ts` | `src/main.ts` `onShortcutKey` (lines 2306-2404) | Written as a table of combos; letters, digits and punctuation match the physical key; the IME and `dialog[open]` guards kept; text fields skipped unless a shortcut allows them |
| `banner.ts` | `src/main.ts` `showBanner`, `paintBanner`, `hideBanner` (lines 1636-1670) | One banner for the window (no document tabs); × hides it until its key changes |
| `statusbar.ts` | `src/main.ts` `flashStatus` (lines 1625-1633) | Resting text kept apart from the notice; `data-drop` items give way in order when the bar is too narrow |
| `theme.ts`, `theme.test.ts` | `src/theme/themes.ts` (shell part: `SHELL_TOKENS`, `applyTheme`, `registerColorTokens`, `themeTransitionCss`), `src/main.ts` `applyEffectiveTheme`, `toggleTheme` | No theme files or user themes: system/light/dark only, values in CSS; status tokens added; the choice mirrored to localStorage for `src/public/theme-boot.js`; the tests check 4.5:1 text contrast and that both dark blocks match |
| `icons.ts` | `src/icons.ts` | Only the close icon |
| `theme/tokens.css`, `theme/dark.css`, `theme/base.css` | `src/style.css` (`:root` tokens, dark blocks, `html`/`body`) | Frond's eight shell tokens and values kept; status tokens (`ok warn hot info batch`, solid row tints) and former literals (`on-danger`, `caption-close`) added; no alpha in any token |
| `shell.css` | `src/style.css` (grid, `.col-header`, `.icon-btn`, side panel, resizer, caption buttons, banner, status bar, `.modal`, dialog, menu) | List in the free width with the details column sized on the right; the banner spans both; the caption cluster is pinned top right; narrow-window rules (side panel over the list below 1000px, details hidden below 720px); token colors only; no product name in CSS content |
