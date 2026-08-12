// One-click opener. Fireflies Live is hosted on Thrivbe-1 (tailnet, systemd —
// always up), so the toolbar click just opens or focuses the tab. The old
// native-messaging dev-server launcher is gone with the localhost deployment.

const URL = "https://hetzner.tail9908c7.ts.net:8453/";
const LEGACY_URLS = ["http://100.114.219.63:3017/"];

const hasPrefix = (tab, prefixes) => typeof tab?.url === "string" && prefixes.some(prefix => tab.url.startsWith(prefix));

async function focusTab(tab, update = {}) {
  const focused = await chrome.tabs.update(tab.id, { ...update, active: true });
  const windowId = focused?.windowId ?? tab.windowId;
  if (Number.isInteger(windowId)) await chrome.windows.update(windowId, { focused: true });
}

async function openOrFocus() {
  const tabs = await chrome.tabs.query({});
  const current = tabs.find(tab => hasPrefix(tab, [URL]));
  if (current) {
    await focusTab(current);
    return;
  }

  const legacy = tabs.find(tab => hasPrefix(tab, LEGACY_URLS));
  if (legacy) {
    await focusTab(legacy, { url: URL });
    return;
  }

  await chrome.tabs.create({ url: URL });
}

async function migrateLegacyTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(tab => hasPrefix(tab, LEGACY_URLS)).map(tab => chrome.tabs.update(tab.id, { url: URL })));
}

const reportError = error => console.error("Fireflies Live launcher failed", error);

chrome.action.onClicked.addListener(() => openOrFocus().catch(reportError));
chrome.runtime.onInstalled.addListener(() => migrateLegacyTabs().catch(reportError));
chrome.runtime.onStartup.addListener(() => migrateLegacyTabs().catch(reportError));
