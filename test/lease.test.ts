import { describe, expect, it } from "vitest";
import { acquireWriterLease, releaseWriterLease } from "../src/lease.js";

describe("writer lease", () => {
  it("allows one writer and rejects a second session", () => {
    const first = acquireWriterLease(undefined, "executor", "session-a", "2026-07-20T00:00:00.000Z");
    expect(() => acquireWriterLease(first, "fixer", "session-b", "2026-07-20T00:01:00.000Z")).toThrow(
      /held by executor\/session-a/,
    );
  });

  it("only lets the owner release the lease", () => {
    const lease = acquireWriterLease(undefined, "fixer", "session-a", "2026-07-20T00:00:00.000Z");
    expect(() => releaseWriterLease(lease, "session-b")).toThrow(/does not own/);
    expect(releaseWriterLease(lease, "session-a")).toBeUndefined();
  });
});
