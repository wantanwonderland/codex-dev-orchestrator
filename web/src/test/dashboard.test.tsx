import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { DataProvider } from "../lib/data-context";
import { productionFallback } from "../lib/data-context";
import { overviewMock, tokenMock } from "../data/mock";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function renderRoute(route: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MemoryRouter initialEntries={[route]}><DataProvider><App /></DataProvider></MemoryRouter>);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("development monitoring dashboard", () => {
  it("never substitutes fabricated projects or tokens in a production outage", () => {
    expect(productionFallback("/api/overview", overviewMock).projects).toEqual([]);
    expect(productionFallback("/api/tokens", tokenMock).records).toEqual([]);
  });
  it("renders operational overview data", async () => {
    const view = await renderRoute("/");
    expect(view.querySelector("h1")?.textContent).toBe("Development overview");
    expect([...view.querySelectorAll("h2")].some((node) => node.textContent === "Project health")).toBe(true);
    expect(view.textContent).toContain("CDO Core");
  });

  it("filters token records by offline coverage", async () => {
    const view = await renderRoute("/tokens");
    const offline = [...view.querySelectorAll("button")].find((button) => button.textContent === "Offline");
    expect(offline).toBeDefined();
    await act(async () => offline!.click());
    expect(view.textContent).toContain("Relay Service");
    expect(view.textContent).not.toContain("Atlas Console");
    expect(view.textContent).toContain("Unavailable");
  });
});
