// Service worker. The toolbar button now opens the side panel (the copilot's
// dock, see sidepanel.html); opening or focusing the app tab moved to a message
// the panel sends, because the app itself cannot live inside the panel — its
// session cookie is SameSite=Strict, so a cross-site frame would land logged out.

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

// Clicking the toolbar icon opens the panel instead of firing action.onClicked.
async function dockPanel() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "open-app") return false;
  openOrFocus().then(() => sendResponse({ ok: true })).catch(error => { reportError(error); sendResponse({ ok: false }); });
  return true; // response is async
});

chrome.runtime.onInstalled.addListener(() => Promise.all([dockPanel(), migrateLegacyTabs()]).catch(reportError));
chrome.runtime.onStartup.addListener(() => Promise.all([dockPanel(), migrateLegacyTabs()]).catch(reportError));
