# Unity Slot Widget

[한국어](README.ko.md)

A small desktop widget for [unity-slot](https://github.com/cyKim0115/unity-slot). It shows, at a glance, which Unity clones (slots) have an editor open, starting or closed, who holds a lease, how much memory each editor tree uses, and git work that exists only on this PC.

The widget is **read-only**: it never opens, closes or leases a slot. All decisions come from `unity-slot dashboard -Json`.

> Work in progress. Screenshots, diagrams and release downloads come with the first release.

## Requirements

- Windows 10 or 11 (WebView2 runtime, built into Windows 11)
- unity-slot with the `dashboard` command (schema `unity-slot.dashboard/1`)

## Run from source

```powershell
npm install
npm run tauri dev
```

`start.bat` builds a release exe, installs it to `%LOCALAPPDATA%\UnitySlotWidget` and starts it. Run it from Explorer or your own terminal.

## License

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for icons and libraries.
