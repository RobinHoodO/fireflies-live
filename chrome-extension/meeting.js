// Pure helpers shared by the side panel. No chrome.* here on purpose, so the
// interesting decisions are testable in plain node (see meeting.test.mjs).

export const APP_URL = "https://hetzner.tail9908c7.ts.net:8453/";

// Call surfaces that live in a browser tab. Zoom's desktop client is invisible
// to an extension by design; only its web client shows up here.
export const MEETING_HOSTS = [
  { host: "meet.google.com", label: "Google Meet" },
  { host: "zoom.us", label: "Zoom" },
  { host: "teams.microsoft.com", label: "Microsoft Teams" },
  { host: "teams.live.com", label: "Microsoft Teams" },
];

export function meetingHost(url) {
  let hostname;
  try { hostname = new URL(String(url)).hostname.toLowerCase(); } catch { return null; }
  return MEETING_HOSTS.find(entry => hostname === entry.host || hostname.endsWith(`.${entry.host}`)) || null;
}

// Meet's lobby and Zoom's landing pages are meeting hosts without being a call.
// A call always has a room id in the path, so an empty path is a home page.
const LOBBY_PATHS = new Set(["/", "", "/landing", "/myhome", "/signin", "/profile"]);

export function isMeetingTab(tab) {
  const entry = meetingHost(tab?.url);
  if (!entry) return false;
  try { return !LOBBY_PATHS.has(new URL(tab.url).pathname.replace(/\/+$/, "") || "/"); } catch { return false; }
}

// The bot joins the call as a participant, so its name is in the page. Both the
// display name and the product name vary ("Fireflies.ai Notetaker", "Notetaker"),
// so match either half rather than one exact string.
const NOTETAKER = /\bfireflies(\.ai)?\b|\bnote[\s-]?taker\b/i;

export function hasNotetaker(pageText) {
  return NOTETAKER.test(String(pageText || ""));
}

export function describeTab(tab, pageText) {
  const entry = meetingHost(tab?.url);
  return {
    id: tab?.id,
    platform: entry ? entry.label : "Unknown",
    title: String(tab?.title || "Untitled tab").slice(0, 80),
    bot: hasNotetaker(pageText),
  };
}
