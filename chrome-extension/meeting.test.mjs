import test from "node:test";
import assert from "node:assert/strict";
import { describeTab, hasNotetaker, isMeetingTab, meetingHost } from "./meeting.js";

test("meeting hosts are recognised, including subdomains, and nothing else is", () => {
  assert.equal(meetingHost("https://meet.google.com/abc-defg-hij")?.label, "Google Meet");
  assert.equal(meetingHost("https://thrivbe.zoom.us/j/12345")?.label, "Zoom");
  assert.equal(meetingHost("https://teams.microsoft.com/l/meetup-join/x")?.label, "Microsoft Teams");
  assert.equal(meetingHost("https://meet.google.com.evil.test/abc"), null);
  assert.equal(meetingHost("https://calendar.google.com/"), null);
  assert.equal(meetingHost("not a url"), null);
  assert.equal(meetingHost(undefined), null);
});

test("a meeting host on its own home page is not a call", () => {
  assert.equal(isMeetingTab({ url: "https://meet.google.com/abc-defg-hij" }), true);
  assert.equal(isMeetingTab({ url: "https://thrivbe.zoom.us/j/12345" }), true);
  assert.equal(isMeetingTab({ url: "https://meet.google.com/" }), false);
  assert.equal(isMeetingTab({ url: "https://zoom.us/profile" }), false);
  assert.equal(isMeetingTab({ url: "https://news.ycombinator.com/item?id=1" }), false);
  assert.equal(isMeetingTab({}), false);
});

test("the notetaker is spotted by either half of its name, and absence is not a false positive", () => {
  assert.equal(hasNotetaker("Robin Sverd\nFireflies.ai Notetaker\nMax"), true);
  assert.equal(hasNotetaker("Participants: Notetaker"), true);
  assert.equal(hasNotetaker("participants: note taker"), true);
  assert.equal(hasNotetaker("Robin Sverd\nMax Semenchuk"), false);
  assert.equal(hasNotetaker(""), false);
  assert.equal(hasNotetaker(null), false);
  // "firefly" is a different word; the bot is "Fireflies".
  assert.equal(hasNotetaker("a firefly in the room"), false);
});

test("a described tab carries only what the panel renders", () => {
  const described = describeTab({ id: 4, url: "https://meet.google.com/abc-defg-hij", title: "Standup" }, "Fireflies.ai Notetaker");
  assert.deepEqual(described, { id: 4, platform: "Google Meet", title: "Standup", bot: true });
  assert.equal(describeTab({ id: 5, url: "https://thrivbe.zoom.us/j/1", title: "x".repeat(200) }, "").title.length, 80);
});
