import { describeTab, isMeetingTab, MEETING_HOSTS } from "./meeting.js";

const meetingsEl = document.getElementById("meetings");
const statusEl = document.getElementById("status");

// Runs inside the meeting tab. Returns the visible text and nothing else; the
// text is read in the panel and never leaves the browser.
function readVisibleText() {
  return document.body?.innerText?.slice(0, 20000) || "";
}

async function meetingTabs() {
  const tabs = await chrome.tabs.query({ url: MEETING_HOSTS.map(entry => `https://*.${entry.host}/*`).concat(MEETING_HOSTS.map(entry => `https://${entry.host}/*`)) });
  return tabs.filter(isMeetingTab);
}

async function inspect(tab) {
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readVisibleText });
    return describeTab(tab, result?.result);
  } catch {
    // A tab Chrome will not let us read (a restricted page, or one that closed
    // mid-scan) is still a meeting tab — we just cannot say who is in it.
    return { ...describeTab(tab, ""), bot: null };
  }
}

function render(meetings) {
  meetingsEl.replaceChildren();
  if (!meetings.length) {
    statusEl.innerHTML = '<div class="empty">No meeting tab open. Join the call in a tab, then hit <b>Rescan tabs</b> — or open Fireflies Live on its own with the button below.</div>';
    return;
  }
  statusEl.textContent = "";
  for (const meeting of meetings) {
    const li = document.createElement("li");
    const platform = document.createElement("div");
    platform.className = "platform";
    platform.textContent = meeting.platform;
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = meeting.title;
    const badge = document.createElement("div");
    badge.className = `badge ${meeting.bot ? "bot-yes" : "bot-no"}`;
    badge.textContent = meeting.bot === null ? "Can't read this tab" : meeting.bot ? "Notetaker is in this call" : "Notetaker not seen yet";
    li.append(platform, title, badge);
    meetingsEl.append(li);
  }
}

async function scan() {
  statusEl.textContent = "Scanning tabs…";
  try {
    render(await Promise.all((await meetingTabs()).map(inspect)));
  } catch (error) {
    statusEl.innerHTML = '<div class="empty">Could not read your tabs. Reload the extension on chrome://extensions.</div>';
    console.error("Fireflies Live panel scan failed", error);
  }
}

// onUpdated fires for every tab on every status change, and each scan injects
// a script into every meeting tab. Coalesce the burst.
let pending;
const scanSoon = () => { clearTimeout(pending); pending = setTimeout(() => { void scan(); }, 500); };

document.getElementById("open").addEventListener("click", () => { chrome.runtime.sendMessage({ type: "open-app" }); });
document.getElementById("refresh").addEventListener("click", () => { void scan(); });
chrome.tabs.onUpdated.addListener(scanSoon);
chrome.tabs.onRemoved.addListener(scanSoon);
void scan();
