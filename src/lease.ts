import type { WriterLease, WriterRole } from "./types.js";

export function acquireWriterLease(
  current: WriterLease | undefined,
  role: WriterRole,
  sessionId: string,
  acquiredAt = new Date().toISOString(),
): WriterLease {
  if (current && current.sessionId !== sessionId) {
    throw new Error(`Writer lease is held by ${current.role}/${current.sessionId}`);
  }
  return { role, sessionId, acquiredAt };
}

export function releaseWriterLease(current: WriterLease | undefined, sessionId: string): undefined {
  if (!current) return undefined;
  if (current.sessionId !== sessionId) {
    throw new Error(`Session ${sessionId} does not own the writer lease`);
  }
  return undefined;
}
