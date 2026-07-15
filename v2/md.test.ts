// Pins the HTML-escaping behavior of the markdown renderer — its output goes
// straight into dangerouslySetInnerHTML with LLM/transcript-derived input.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mdToHtml } from "./md.ts";

test("script tags are escaped", () => {
  const out = mdToHtml("<script>alert(1)</script>");
  assert.ok(out.includes("&lt;script&gt;"));
  assert.ok(!out.includes("<script>"));
});

test("ampersand is escaped", () => {
  assert.ok(mdToHtml("a & b").includes("&amp;"));
});

test("img onerror payload is escaped", () => {
  const out = mdToHtml("<img src=x onerror=alert(1)>");
  assert.ok(out.includes("&lt;img"));
  assert.ok(!out.includes("<img"));
});

test("bold renders as <strong>", () => {
  const out = mdToHtml("**bold**");
  assert.match(out, /<strong[^>]*>bold<\/strong>/);
});

test("inline code renders as <code>", () => {
  const out = mdToHtml("`code`");
  assert.match(out, /<code[^>]*>code<\/code>/);
});

test("dash line renders a list item", () => {
  const out = mdToHtml("- item");
  assert.ok(out.includes("<ul"));
  assert.match(out, /<li>item<\/li>/);
});
