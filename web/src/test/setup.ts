export {};

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

class EventSourceStub {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, "EventSource", { value: EventSourceStub, writable: true });

globalThis.fetch = async () => new Response(null, { status: 503 });
