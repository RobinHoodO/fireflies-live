export interface TranscriptChunk {
  transcriptId: string;
  chunkId: string;
  text: string;
  speakerName: string;
  startTime: number;
  endTime: number;
}

export interface TranscriptMessage {
  id: string;
  speakerName: string;
  text: string;
  timestamp: number;
  isPartial: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'suggestion';
  text: string;
  timestamp: number;
}

export interface MeetingInfo {
  id: string;
  title: string;
  organizerEmail: string;
  meetingLink: string;
  startTime: number;
  state: 'active' | 'paused';
}

export interface FeatureFlags {
  liveTranscription: boolean;
  aiSuggestions: boolean;
  autoActions: boolean;
  codePalette: boolean;
  sentimentTracking: boolean;
  keyMoments: boolean;
  commandMode: boolean;
  meetingNotes: boolean;
}

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  category: 'info' | 'action' | 'integration' | 'communication';
  prompt: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
