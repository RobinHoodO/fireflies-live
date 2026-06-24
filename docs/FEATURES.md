# Fireflies Live — Feature List

Tracked feature inventory. Status: ✅ done · 🟡 in progress · ⬜ planned.
See [ROADMAP.md](./ROADMAP.md) for phasing.

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
| OpenRouter model picker | ✅ | 6 models, DeepSeek default |
| Real transcript-driven suggestions | ✅ | Throttled pulse |
| Configurable pulse rate | ✅ | 8/12/20/30s / off |
| Suggestion history feed (newest-first) | ✅ | Deduped, capped 100 |
| Suggestion type filter (question/action/insight) | 🟡 | Click to filter |
| Suggestion expand/collapse (show newest/most-relevant) | 🟡 | Avoid overlong feed |
| Question mode (live "say this" draft) | ✅ | Toggle; banner over transcript |
| Agent-context preset modes | ✅ | Clickable chips |
| AI-proposed modes from meeting | ✅ | "Suggest modes" button |
| Custom agent context | ✅ | Textarea, fed to all calls |
| Quick-action command palette | ✅ | Category filters |
| Chat with the meeting | ✅ | Uses transcript context |
| Rich markdown in AI output | ✅ | react-markdown + remark-gfm |
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
| Session persistence (localStorage) | ⬜ | Phase 2 |
| Export to Markdown | ⬜ | Phase 2 |
| Keyboard shortcuts | ⬜ | Phase 2 |
| AI-offline / key-missing state | ⬜ | Phase 2 |

## Platform / backend
| Feature | Status | Notes |
|---|---|---|
| PI backend delegation bridge | ⬜ | Phase 3, localhost-only + guardrails |
| Backend terminal pane (mounts when live) | ⬜ | Phase 3 |
| Chrome MV3 side-panel extension | ⬜ | Phase 4 |
| One-click "Join Live" from meeting tab | ⬜ | Phase 4 |
| Tests + CI | ⬜ | Phase 5 |
