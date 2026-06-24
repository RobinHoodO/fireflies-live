import type {
  TranscriptChunk,
  TranscriptMessage,
  ConnectionStatus,
  FeatureFlags,
} from '../types';

const SIMULATED_SPEAKERS = ['Alice Chen', 'Marcus Johnson', 'Sarah Kim', 'David Park'];
const SIMULATED_CONVERSATION: [string, string][] = [
  ['Alice Chen', 'Alright, let\'s kick off the sprint planning. We need to finalize the API integration timeline.'],
  ['Marcus Johnson', 'I\'ve been looking at the Fireflies API docs. The real-time WebSocket looks solid — we can stream live transcription.'],
  ['Sarah Kim', 'What\'s the latency like? If we\'re building a live agent, every second counts.'],
  ['Marcus Johnson', 'From the docs, it\'s about 1-2 seconds behind. Not bad for transcription.'],
  ['David Park', 'I can wire up the Socket.IO client today. The auth flow is straightforward — just an API token and transcript ID.'],
  ['Alice Chen', 'Great. Sarah, what about the AI suggestions feature? That\'s the core differentiator.'],
  ['Sarah Kim', 'We can pipe the transcription stream directly into the LLM context. As each chunk arrives, we check for trigger phrases.'],
  ['Marcus Johnson', 'What triggers are we thinking? Questions? Action items?'],
  ['Sarah Kim', 'Questions, deadlines, decisions, and any explicit "hey can someone look up..." type requests.'],
  ['David Park', 'Should we also listen for sentiment? Like if someone sounds frustrated or confused?'],
  ['Alice Chen', 'Yes, but let\'s ship the core features first. Transcription + suggestions + commands. We can add sentiment in v2.'],
  ['Marcus Johnson', 'Agreed. I\'ll start on the command palette — that\'s the quick-action interface.'],
  ['Sarah Kim', 'For the suggestions UI, I\'m thinking a sidebar panel with real-time cards that update as the conversation evolves.'],
  ['David Park', 'We should also add a "whisper mode" where the agent can DM the host privately instead of posting to everyone.'],
  ['Alice Chen', 'Love that. Okay, action items: Marcus on command palette, Sarah on suggestions engine, David on Fireflies integration.'],
  ['Sarah Kim', 'I\'ll also spike on the context window management. We don\'t want to blow past token limits on long meetings.'],
  ['Marcus Johnson', 'Good call. What\'s the plan for the demo? We need something working by Friday.'],
  ['Alice Chen', 'Minimal viable: live transcription feed + command palette with at least 5 working actions. Suggestions can be simulated.'],
  ['David Park', 'I can have the Fireflies connection working by tomorrow. Then we integrate.'],
];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createFirefliesConnection(
  onChunk: (chunk: TranscriptChunk) => void,
  onStatusChange: (status: ConnectionStatus) => void,
  onTranscriptMessage: (msg: TranscriptMessage) => void
) {
  let running = false;
  let index = 0;
  const transcriptId = `meeting_${Date.now()}`;
  const seenChunkIds = new Set<string>();

  const emitChunk = (speakerName: string, text: string) => {
    index++;
    const chunkId = `chunk_${String(index).padStart(4, '0')}`;
    const now = Date.now();

    const chunk: TranscriptChunk = {
      transcriptId,
      chunkId,
      text,
      speakerName,
      startTime: index * 3,
      endTime: index * 3 + 2.5,
    };

    onChunk(chunk);

    if (!seenChunkIds.has(chunkId)) {
      seenChunkIds.add(chunkId);
      onTranscriptMessage({
        id: chunkId,
        speakerName,
        text,
        timestamp: now,
        isPartial: false,
      });
    }
  };

  return {
    async connect() {
      running = true;
      onStatusChange('connecting');
      await delay(800);
      onStatusChange('connected');

      for (const [speaker, text] of SIMULATED_CONVERSATION) {
        if (!running) break;

        // Simulate incremental transcription
        const words = text.split(' ');
        let partial = '';

        for (let i = 0; i < words.length; i++) {
          if (!running) break;
          partial += (i === 0 ? '' : ' ') + words[i];
          emitChunk(speaker, partial);
          await delay(80 + Math.random() * 100);
        }

        // Pause between speakers
        await delay(600 + Math.random() * 900);
      }

      if (running) {
        onStatusChange('disconnected');
      }
    },

    disconnect() {
      running = false;
      onStatusChange('disconnected');
    },
  };
}

export function useFirefliesConnection(
  onChunk: (chunk: TranscriptChunk) => void,
  onStatusChange: (status: ConnectionStatus) => void,
  onTranscriptMessage: (msg: TranscriptMessage) => void
) {
  return createFirefliesConnection(onChunk, onStatusChange, onTranscriptMessage);
}
