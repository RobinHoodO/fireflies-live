// Minimal Markdown → HTML, ported verbatim from the design source so AI
// bubbles render bold / italics / lists / inline code exactly as designed.
export function mdToHtml(src: string): string {
  if (!src) return "";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inl = (t: string) => esc(t)
    .replace(/`([^`]+)`/g, '<code style="font-family:JetBrains Mono,monospace;font-size:.85em;background:oklch(0.95 0.012 250);padding:2px 6px;border-radius:5px;color:var(--ac-text,oklch(0.45 0.17 242))">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:700;color:oklch(0.24 0.02 255)">$1</strong>')
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  const lines = src.split("\n"); let out = ""; let mode: string | null = null; let code = "";
  const close = () => { if (mode === "ul") out += "</ul>"; if (mode === "ol") out += "</ol>"; if (mode === "ul" || mode === "ol") mode = null; };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^```/.test(ln)) { if (mode === "code") { out += '<pre style="font-family:JetBrains Mono,monospace;font-size:12.5px;background:oklch(0.96 0.008 250);padding:12px 14px;border-radius:10px;overflow-x:auto;margin:8px 0">' + esc(code) + "</pre>"; mode = null; code = ""; } else { close(); mode = "code"; code = ""; } continue; }
    if (mode === "code") { code += (code ? "\n" : "") + ln; continue; }
    const h = ln.match(/^(#{1,3})\s+(.*)/);
    if (h) { close(); const lv = h[1].length; const sz = lv === 1 ? "17px" : lv === 2 ? "15.5px" : "14px"; out += '<div style="font-weight:700;font-size:' + sz + ';color:oklch(0.24 0.02 255);margin:' + (out ? "12px" : "0") + ' 0 6px">' + inl(h[2]) + "</div>"; continue; }
    const li = ln.match(/^\s*[-*]\s+(.*)/);
    if (li) { if (mode !== "ul") { close(); out += '<ul style="margin:6px 0;padding-left:18px;display:flex;flex-direction:column;gap:5px">'; mode = "ul"; } out += "<li>" + inl(li[1]) + "</li>"; continue; }
    const ol = ln.match(/^\s*\d+\.\s+(.*)/);
    if (ol) { if (mode !== "ol") { close(); out += '<ol style="margin:6px 0;padding-left:18px;display:flex;flex-direction:column;gap:5px">'; mode = "ol"; } out += "<li>" + inl(ol[1]) + "</li>"; continue; }
    if (ln.trim() === "") { close(); continue; }
    close(); out += '<p style="margin:0 0 8px;line-height:1.65">' + inl(ln) + "</p>";
  }
  close();
  return out;
}
