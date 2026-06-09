// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "./App";
import { useStore } from "./storage/store";
import { emptyPortfolio } from "./domain/types";

afterEach(() => {
  cleanup();
  localStorage.clear();
  useStore.setState({ portfolio: emptyPortfolio(), loaded: false });
});

describe("App integration (demo flow)", () => {
  it("loads the demo portfolio and renders the dashboard", async () => {
    render(<App />);

    // First run with no data lands on Add data; load the demo.
    const demoBtn = await screen.findByText(/Load demo portfolio/i);
    fireEvent.click(demoBtn);

    // Navigate to the Overview tab.
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));

    // Net-worth card + a crore-scale value should render from the computed brief.
    expect(await screen.findByText("Net worth")).toBeTruthy();
    expect(screen.getAllByText(/Cr/).length).toBeGreaterThan(0);

    // The allocation donut legend should include real Indian asset classes.
    expect(screen.getAllByText(/Indian Equity/i).length).toBeGreaterThan(0);

    // Switching the allocation dimension to "Tax class" re-groups without error.
    fireEvent.click(screen.getByRole("button", { name: "Tax class" }));
    expect(screen.getAllByText(/Tax-free \(EEE\)/i).length).toBeGreaterThan(0);
  });

  it("shows the privacy transparency screen", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Privacy" }));
    const heading = await screen.findByText(/Where your data lives/i);
    expect(heading).toBeTruthy();
    // The export/erase controls are present.
    const root = heading.closest(".app") as HTMLElement;
    expect(within(root).getByText(/Erase all data/i)).toBeTruthy();
  });
});
