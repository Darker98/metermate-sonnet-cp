import type { SessionData } from '../types.js';
import { config } from '../config.js';

const store = new Map<string, SessionData>();

function get(sessionId: string): SessionData | undefined {
  return store.get(sessionId);
}

function put(data: Omit<SessionData, 'updatedAt'> & { updatedAt?: number }): void {
  store.set(data.sessionId, {
    ...data,
    updatedAt: Date.now(),
  });
}

function remove(sessionId: string): void {
  store.delete(sessionId);
}

function sweep(): void {
  const cutoff = Date.now() - config.session.ttlMinutes * 60 * 1000;
  for (const [id, session] of store.entries()) {
    if (session.updatedAt < cutoff) {
      store.delete(id);
    }
  }
}

function size(): number {
  return store.size;
}

export const sessionStore = { get, put, remove, sweep, size };
