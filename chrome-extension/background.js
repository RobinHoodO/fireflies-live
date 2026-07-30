// One-click opener. Fireflies Live is hosted on Thrivbe-1 (tailnet, systemd —
// always up), so the toolbar click just opens or focuses the tab. The old
// native-messaging dev-server launcher is gone with the localhost deployment.

const URL = "http://100.114.219.63:3017/";

chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: `${URL}*` });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: URL });
  }
});
