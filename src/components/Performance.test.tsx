// @vitest-environment jsdom
// The Performance tab promises HONEST numbers: P&L only for holdings with a real purchase
// cost (no estimated bases dressed up as gains), a coverage card for what's left out, and
// the recorded per-account stack instead of any simulation.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../storage/store";
import { emptyPortfolio } from "../domain/types";
import { demoPortfolio } from "../demo";
import { Performance } from "./Performance";

afterEach(() => {
  cleanup();
  useStore.setState({ portfolio: emptyPortfolio(), loaded: true });
});

const renderWithDemo = () => {
  useStore.setState({ portfolio: demoPortfolio(), loaded: true });
  return render(<Performance />);
};

describe("Performance — real purchase costs only", () => {
  it("lists holdings with a real basis and omits estimated/no-basis ones", () => {
    renderWithDemo();
    expect(screen.getByText("Varun Beverages")).toBeTruthy(); // real basis
    // No purchase cost on file → must NOT appear in the P&L table at all.
    expect(screen.queryByText("EPF + VPF balance")).toBeNull();
    expect(screen.queryByText("Consistent Compounders Portfolio")).toBeNull();
    expect(screen.queryByText("Primary residence — Mumbai")).toBeNull();
  });

  it("says how much is unmeasured and where to fix it", () => {
    renderWithDemo();
    expect(screen.getByText("Measured")).toBeTruthy();
    expect(screen.getAllByText(/have no purchase cost|without\s+one/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/≈/)).toBeNull(); // the estimate marker is gone for good
  });

  it("shows the recorded per-account stack, not a simulation", () => {
    renderWithDemo();
    expect(screen.getByText("Your portfolio, account by account")).toBeTruthy();
    expect(screen.getAllByText(/Zerodha Demat/).length).toBeGreaterThan(0); // legend + table rows
    expect(screen.queryByText(/simulat/i)).toBeNull(); // no simulation language anywhere
  });

  it("the big accounts get bands; the small tail rolls into Other", () => {
    renderWithDemo();
    expect(screen.getByText(/Real Estate/)).toBeTruthy(); // biggest account, own band
    // The demo's small/new accounts (Groww folio, Alibaug plot) live inside the roll-up.
    expect(screen.getByText(/Other accounts \(\d+\)/)).toBeTruthy();
  });

  it("the table can be organized by account, with per-account subtotal headers", () => {
    renderWithDemo();
    fireEvent.click(screen.getByRole("button", { name: "By account" }));
    // Group headers carry a holding count; rows lose their account suffix (it's the header now).
    expect(screen.getAllByText(/· \d+ holdings?$/).length).toBeGreaterThan(1);
    expect(screen.getByText("Varun Beverages")).toBeTruthy(); // still listed, under Zerodha Demat
    // Accounts with no real-basis holdings (e.g. Provident Fund) get no group header.
    const headers = screen.getAllByText(/· \d+ holdings?$/).map((el) => el.parentElement?.textContent ?? "");
    expect(headers.some((t) => t.includes("Provident Fund"))).toBe(false);
  });
});
