# Fireflies Live side panel (Chrome extension)

MV3 side panel. Click the toolbar icon and the copilot's dock opens **beside the
call**: it lists the meeting tabs you have open, says whether the Fireflies
notetaker has joined each one, and gives you one-click **Join Live**.

Fireflies Live itself is hosted on Thrivbe-1
(`https://hetzner.tail9908c7.ts.net:8453/`, tailnet-only HTTPS via Tailscale
Serve, always up via systemd). Requires the Mac to be on the tailnet.

## How it works
- `background.js` (service worker) sets `openPanelOnActionClick`, so the toolbar
  button opens the panel. It still opens/focuses the app tab — now on the
  `open-app` message the panel sends — and still migrates tabs left on the
  retired direct-IP URL on install and startup.
- `sidepanel.js` lists tabs on the meeting hosts, then injects a one-line
  reader into each to see whether the notetaker's name is in the page.
- `meeting.js` holds the decisions worth testing (which hosts count, what is a
  call rather than a home page, what the bot's name looks like).

## Why the app opens in a tab and not inside the panel
The app's session cookie is `HttpOnly; SameSite=Strict`. A side panel document
is `chrome-extension://…`, so an `<iframe>` of the app is a **cross-site** frame:
the cookie is never sent and the frame would render logged out. Chrome's
third-party-cookie blocking would stop it re-authenticating too.

Embedding it for real needs a deliberate server-side decision — relaxing the
cookie to `SameSite=None; Secure` and adding a
`Content-Security-Policy: frame-ancestors chrome-extension://<id>` — which
trades away part of the CSRF posture on the private app. That is Robin's call,
not the extension's. Until then the panel is the dock and the app is one click
away in its own tab, with its auth untouched.

## What it can and cannot see
- **Google Meet, Zoom web client, Microsoft Teams** in a browser tab. Zoom's
  **desktop app is invisible** to any extension — a Zoom call in the app will
  not be listed.
- Detection reads the meeting page's visible text (capped at 20 000 chars) to
  look for the notetaker's name. That text is read in the panel and **never
  leaves the browser** — nothing is sent to Fireflies Live or anywhere else.
- Host access is limited to the four meeting hosts in `manifest.json`, and the
  reader is injected on demand rather than running as an always-on content
  script.
- "Notetaker not seen yet" is a hint, not proof: a call whose participant list
  is collapsed can hide the bot.

## Install / update
1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top-right)
3. **Load unpacked** → select this folder — or hit ⟳ on the existing card after
   pulling changes. Unpacked extensions do not auto-update; the checked-in
   manifest version makes the loaded revision visible.
4. Pin the "Fireflies Live" icon. Click it — the panel opens.

## Files
- `manifest.json` — MV3, `key` (fixed ID), `sidePanel` + `scripting` + `tabs`,
  meeting-host permissions
- `background.js` — service worker: dock the panel, open/focus the app tab
- `sidepanel.html` / `sidepanel.js` — the panel
- `meeting.js` — pure helpers (`meeting.test.mjs` covers them)
- `icon.png` — toolbar icon
- `native-host/` — retired local-launcher (kept locally, not in git); its Chrome
  manifest in `~/Library/.../NativeMessagingHosts/` can be deleted

## Tests
`npm test` from the repo root runs `background.test.mjs` (the service worker,
driven through a stub `chrome`) and `meeting.test.mjs` (host matching, call vs
home page, notetaker name matching).
