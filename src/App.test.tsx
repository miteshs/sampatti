// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// App refreshes the USD→INR rate on launch — tests must never hit the real network.
const { fxMock } = vi.hoisted(() => ({ fxMock: vi.fn(async () => null as number | null) }));
vi.mock("./domain/fx", () => ({ fetchUsdInr: fxMock }));

import App from "./App";
import { useStore } from "./storage/store";
import { emptyPortfolio } from "./domain/types";

afterEach(() => {
  cleanup();
  localStorage.clear();
  useStore.setState({ portfolio: emptyPortfolio(), loaded: false });
  fxMock.mockClear();
  fxMock.mockImplementation(async () => null);
});

describe("App integration (demo flow)", () => {
  it("loads the demo portfolio and renders the dashboard", async () => {
    render(<App />);

    // First run with no data lands on Add data; load the demo.
    const demoBtn = await screen.findByText(/Try the sample portfolio/i);
    fireEvent.click(demoBtn);

    // Navigate to the Overview tab. The desktop pill nav and the mobile bottom tab bar both
    // render (CSS hides one per breakpoint; jsdom applies no stylesheet), so target the first.
    fireEvent.click(screen.getAllByRole("button", { name: "Overview" })[0]);

    // Net-worth card + a crore-scale value should render from the computed brief.
    expect(await screen.findByText("Net worth")).toBeTruthy();
    expect(screen.getAllByText(/Cr/).length).toBeGreaterThan(0);

    // The allocation donut legend should include real Indian asset classes.
    expect(screen.getAllByText(/Indian Equity/i).length).toBeGreaterThan(0);

    // Switching the allocation dimension to the tax view re-groups without error.
    fireEvent.click(screen.getByRole("button", { name: "How it's taxed" }));
    expect(screen.getAllByText(/Tax-free \(EEE\)/i).length).toBeGreaterThan(0);
  });

  it("Cmd-F opens the search palette", async () => {
    render(<App />);
    await screen.findByText("Sampatti");
    expect(screen.queryByLabelText("Search holdings")).toBeNull();
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(screen.getByLabelText("Search holdings")).toBeTruthy();
  });

  it("opens the per-account editor (Manage tab) without looping/blanking, and edits write through", async () => {
    render(<App />);
    fireEvent.click(await screen.findByText(/Try the sample portfolio/i));
    fireEvent.click(screen.getAllByRole("button", { name: "Holdings" })[0]);
    // Account editing lives on the merged Holdings tab now (Manage + Add data).
    const editBtn = await screen.findAllByRole("button", { name: "Edit" });

    // Clicking Edit used to mount AccountEditor with a selector that returned a fresh array each
    // render → useSyncExternalStore infinite loop → blank screen. This must just open.
    fireEvent.click(editBtn[0]);
    expect(await screen.findByText("Account Details")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();

    // Editor writes go to the store (add a holding via the editor).
    const before = useStore.getState().portfolio.holdings.length;
    fireEvent.click(screen.getByRole("button", { name: "+ Add holding" }));
    expect(useStore.getState().portfolio.holdings.length).toBe(before + 1);
  });

  it("privacy controls + explainer live under Settings (no separate tab)", async () => {
    render(<App />);
    await screen.findByText(/All your money, in one private picture/i); // first-run welcome = loaded
    fireEvent.click(screen.getAllByRole("button", { name: "Settings" })[0]);
    // Privacy & data section in Settings: export + erase controls.
    expect(await screen.findByText(/Erase all data/i)).toBeTruthy();
    expect(screen.getByText(/Export everything/i)).toBeTruthy();
    // The transparency explainer is one click away, in a modal.
    fireEvent.click(screen.getByText(/How Sampatti handles your data/i));
    expect(await screen.findByText(/Where your data lives/i)).toBeTruthy();
  });

  it("saves a manual account even when the holding row wasn't explicitly added", async () => {
    render(<App />);
    await screen.findByText(/Add an account by hand/i);

    // Fill the account name and the holding fields — but do NOT click "+ Add item".
    fireEvent.change(screen.getByPlaceholderText("e.g. Mumbai flat"), { target: { value: "Cash Reserve" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. Flat market value"), { target: { value: "Emergency fund" } });
    fireEvent.change(screen.getByPlaceholderText("2500000"), { target: { value: "750000" } });

    const saveBtn = screen.getByRole("button", { name: "Save account" }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false); // was stuck disabled before the fix
    fireEvent.click(saveBtn);

    const p = useStore.getState().portfolio;
    expect(p.accounts.some((a) => a.name === "Cash Reserve")).toBe(true);
    expect(p.holdings.some((h) => h.name === "Emergency fund" && h.marketValue === 750000)).toBe(true);
  });
});

describe("launch-time FX refresh", () => {
  it("applies the live USD→INR rate once the app has loaded", async () => {
    fxMock.mockImplementation(async () => 88.42);
    render(<App />);
    await waitFor(() => expect(useStore.getState().portfolio.settings.usdInr).toBe(88.42));
    expect(fxMock).toHaveBeenCalledOnce();
  });

  it("keeps the stored rate when the fetch fails (offline launch)", async () => {
    fxMock.mockImplementation(async () => null);
    render(<App />);
    await waitFor(() => expect(fxMock).toHaveBeenCalled());
    expect(useStore.getState().portfolio.settings.usdInr).toBe(95); // the default, untouched
  });
});
