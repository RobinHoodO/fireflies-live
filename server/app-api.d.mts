import type { IncomingMessage, ServerResponse } from "node:http";

export interface AppApiOptions {
  envFile: string;
  bridgeToken: string;
  bridgeOrigin?: string;
  recordsDir: string;
  fetchImpl?: typeof fetch;
  realtime?: (meetingId: string, token: string) => Promise<unknown>;
  meetingStore?: unknown;
  requireAuth?: boolean;
  secureCookie?: boolean;
  sessionTtlMs?: number;
}

export function createAppApi(options: AppApiOptions): (req: IncomingMessage, res: ServerResponse) => boolean;
