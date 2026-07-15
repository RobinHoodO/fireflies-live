# Fireflies Live — Feature List

Tracked feature inventory. Status: ✅ done · 🟡 in progress · ⬜ planned.
**[ROADMAP.md](./ROADMAP.md) is the source of truth for status and phasing** — on
any disagreement between the two files, trust the roadmap and fix this one.

## Transcription
| Feature | Status | Notes |
|---|---|---|
| Live Fireflies realtime stream | ✅ | Socket.IO, payload under `data.payload` |
| Speaker-grouped paragraphs | ✅ | New line only on speaker change |
| Auto-fetch active meetings on load | ✅ | `active_meetings` GraphQL |
| Per-session one-click Connect | ✅ | From Active Meetings (top-right) |
| Paste meeting ID | ✅ | Next to Active Meetings |
| Demo mode | ✅ | Fallback when Live API off |
| Copy transcript | ✅ | Grouped form |
| Recent/past meetings browser | ⬜ | Hidden for now, revisit Phase 5 |

## AI assistant
| Feature | Status | Notes |
|---|---|---|
| OpenRouter model picker | ✅ | Grouped roster (~22), Claude Sonnet 5 default |
| Real transcript-driven suggestions | ✅ | Throttled pulse |
| Configurable pulse rate | ✅ | 8/12/20/30s / off |
| Suggestion history feed (newest-first) | ✅ | Deduped, capped 100 |
| Suggestion type filter (ask/do/note/command) | ✅ | Click to filter |
| Suggestion expand/collapse (show newest/most-relevant) | ✅ | Show more/less, ~5 default |
| Question mode (live "say this" draft) | ✅ | Toggle; banner over transcript |
| Agent-context preset modes | ✅ | Clickable chips |
| AI-proposed modes from meeting | ✅ | "Suggest modes" button |
| Custom agent context | ✅ | Textarea, fed to all calls |
| Quick-action command palette | ✅ | Category filters |
| Chat with the meeting | ✅ | Uses transcript context |
| Rich markdown in AI output | ✅ | v2/md.ts renderer (react-markdown retired with v1) |
| Relevance ranking (beyond recency) | ⬜ | Phase 5 |
| Auto-actions (no-click execution) | ⬜ | Phase 5 |

## Workspace / UX
| Feature | Status | Notes |
|---|---|---|
| Light, spacious, centered frame | ✅ | Off the screen edges |
| View modes: Transcript / Split / Chat | ✅ | |
| Resizable split divider | ✅ | Drag to set ratio |
| Full-screen centered chat | ✅ | Chat view |
| Contextual Stop (only when connected) | ✅ | In status pill |
| Export to Markdown | ✅ | Transcript + suggestions + chat |
| AI-offline / key-missing state | ✅ | Note when OPENROUTER_API missing |
| Granular OpenRouter model picker | ✅ | ~22 models, grouped optgroups |
| Session persistence (localStorage) | ✅ | Phase 2, shipped 2026-07-12 |
| Keyboard shortcuts | ✅ | Phase 2, shipped 2026-07-12 (⌘1/2/3, ⌘K, ⌘U, ⌘J) |

## Platform / backend
| Feature | Status | Notes |
|---|---|---|
| PI backend delegation bridge | ✅ | localhost-only, denylist + confirm + audit |
| Backend terminal pane | ✅ | Sidebar pane, online/offline, live output |
| Chrome MV3 side-panel extension | ⬜ | Phase 4 |
| One-click "Join Live" from meeting tab | ⬜ | Phase 4 |
| Tests + CI | ⬜ | Phase 5 |
