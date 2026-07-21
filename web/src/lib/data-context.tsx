import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { overviewMock, projectMocks, settingsMock, tokenMock, workflowMock } from "../data/mock";

type ConnectionState = "connecting" | "live" | "offline";

interface DataContextValue {
  fallback: boolean;
  connection: ConnectionState;
  lastEventAt: string;
  refreshKey: number;
  markFallback: () => void;
  markLive: () => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [fallback, setFallback] = useState(true);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [lastEventAt, setLastEventAt] = useState(overviewMock.lastEventAt);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (import.meta.env.MODE === "test") return;
    const events = new EventSource("/api/events");
    events.onopen = () => setConnection("live");
    events.onmessage = (event) => {
      setConnection("live");
      setLastEventAt(event.lastEventId || new Date().toISOString());
      setRefreshKey((key) => key + 1);
    };
    events.onerror = () => {
      setConnection("offline");
    };
    return () => events.close();
  }, []);

  const markFallback = useCallback(() => setFallback(true), []);
  const markLive = useCallback(() => setFallback(false), []);
  const value = useMemo(() => ({ fallback, connection, lastEventAt, refreshKey, markFallback, markLive }), [fallback, connection, lastEventAt, refreshKey, markFallback, markLive]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useDataStatus() {
  const context = useContext(DataContext);
  if (!context) throw new Error("useDataStatus must be used within DataProvider");
  return context;
}

export function useApiData<T>(endpoint: string, fallbackData: T) {
  const { refreshKey, markFallback, markLive } = useDataStatus();
  const demoData = import.meta.env.DEV || import.meta.env.MODE === "test";
  const unavailable = useMemo(() => productionFallback(endpoint, fallbackData), [endpoint, fallbackData]);
  const [data, setData] = useState<T>(demoData ? fallbackData : unavailable);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(endpoint, { headers: { Accept: "application/json" }, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        return response.json() as Promise<T>;
      })
      .then((value) => { setData(value); markLive(); })
      .catch((error: Error) => {
        if (error.name !== "AbortError") {
          setData(demoData ? fallbackData : unavailable);
          markFallback();
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [demoData, endpoint, fallbackData, markFallback, markLive, refreshKey, unavailable]);

  return { data, loading };
}

export function productionFallback<T>(endpoint: string, fallback: T): T {
  if (endpoint === "/api/overview") return { projects: [], rateLimits: [], lastEventAt: "" } as T;
  if (endpoint === "/api/tokens") return { records: [], rateLimits: [] } as T;
  if (endpoint === "/api/settings") return { roots: [], retentionDays: 0, eventStreamUrl: "/api/events", lastPurgeAt: "" } as T;
  if (endpoint.startsWith("/api/projects/")) return {
    ...(fallback as Record<string, unknown>), id: "unavailable", name: "Monitoring unavailable", path: "", branch: "unknown",
    health: "offline", live: false, workflowId: "none", workflowName: "No workflow data", phase: "offline",
    status: "blocked", developed: "No live dashboard data", role: "unavailable", model: "unavailable", tokens: 0,
    progress: 0, coverage: "offline", history: [], tasks: { complete: 0, total: 0, blocked: 0 },
  } as T;
  if (endpoint.startsWith("/api/workflows/")) return {
    ...(fallback as Record<string, unknown>), id: "unavailable", name: "Monitoring unavailable", projectId: "unavailable",
    projectName: "Dashboard offline", objective: "No live workflow data", status: "blocked", phase: "offline",
    phases: [], tasks: [], assignments: [], history: [],
  } as T;
  return fallback;
}

export const fallbacks = { overviewMock, projectMocks, workflowMock, tokenMock, settingsMock };
