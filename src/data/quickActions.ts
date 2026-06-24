import type { QuickAction } from '../types';

export const QUICK_ACTIONS: QuickAction[] = [
  // Info commands
  { id: 'summarize', label: 'Summarize so far', icon: '📋', category: 'info', prompt: 'Summarize the key points discussed so far.' },
  { id: 'action-items', label: 'Extract action items', icon: '✅', category: 'info', prompt: 'List all action items and decisions made in this meeting.' },
  { id: 'who-said', label: 'Who said what', icon: '👤', category: 'info', prompt: 'Show who said what, organized by speaker.' },
  { id: 'timeline', label: 'Meeting timeline', icon: '⏱️', category: 'info', prompt: 'Create a timeline of topics discussed with timestamps.' },

  // Action commands
  { id: 'create-issue', label: 'Create GitHub issue', icon: '🐛', category: 'action', prompt: 'Create a GitHub issue from the current discussion.' },
  { id: 'send-email', label: 'Send follow-up email', icon: '✉️', category: 'action', prompt: 'Draft and send a follow-up email summarizing this meeting.' },
  { id: 'schedule', label: 'Schedule next meeting', icon: '📅', category: 'action', prompt: 'Check availability and schedule the next meeting.' },
  { id: 'create-doc', label: 'Create meeting doc', icon: '📄', category: 'action', prompt: 'Create a structured meeting notes document.' },

  // Integration commands
  { id: 'search-docs', label: 'Search internal docs', icon: '🔍', category: 'integration', prompt: 'Search the internal documentation for the current topic.' },
  { id: 'pull-data', label: 'Pull analytics', icon: '📊', category: 'integration', prompt: 'Pull relevant analytics or metrics mentioned in the conversation.' },
  { id: 'check-status', label: 'Check deployment status', icon: '🚀', category: 'integration', prompt: 'Check the current deployment status and any ongoing incidents.' },

  // Communication commands
  { id: 'clarify', label: 'Ask for clarification', icon: '❓', category: 'communication', prompt: 'What points need clarification based on the conversation?' },
  { id: 'suggest', label: 'Suggest response', icon: '💡', category: 'communication', prompt: 'Based on the last statement, suggest what I should say next.' },
  { id: 'reframe', label: 'Reframe objection', icon: '🔄', category: 'communication', prompt: 'Help me reframe the last objection constructively.' },
  { id: 'data-point', label: 'Find supporting data', icon: '📈', category: 'communication', prompt: 'Find data points or statistics that support the current discussion.' },
];
