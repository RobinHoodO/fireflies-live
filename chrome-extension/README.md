# Fireflies Live Launcher (Chrome extension)

One click on the toolbar icon → opens/focuses Fireflies Live, hosted on
Thrivbe-1 (`http://100.114.219.63:3017/`, tailnet-only, always up via systemd).

## How it works
`background.js` opens or focuses the app tab. That's it — since the app moved
to Thrivbe-1 (2026-07-30) there is no local dev server to boot, so the old
native-messaging launcher (`native-host/`) is retired.

Requires the Mac to be on the tailnet (Tailscale running).

## Install / update
1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top-right)
3. **Load unpacked** → select this folder — or hit ⟳ on the existing card
   after pulling changes
4. Pin the "Fireflies Live Launcher" icon. Click it — done.

## Files
- `manifest.json` — MV3, `key` (fixed ID), `tabs` permission
- `background.js` — service worker: click → open/focus tab
- `icon.png` — toolbar icon
- `native-host/` — retired local-launcher (kept locally, not in git); its
  Chrome manifest in `~/Library/.../NativeMessagingHosts/` can be deleted
