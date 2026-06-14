// @vitest-environment jsdom
// Retirement card: money inputs must be in the region's currency (₹ India, $ US), converting
// to the INR base at the edge — and the default current age is 55.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStore } from "../storage/store";
import { emptyPortfolio } from "../domain/types";
import { Goals } from "./Goals";

function setRegion(country: "India" | "US", usdInr = 80) {
  const p = emptyPortfolio();
  p.settings.country = country;
  p.settings.usdInr = usdInr;
  useStore.setState({ portfolio: p, loaded: true });
}
beforeEach(() => setRegion("India"));
afterEach(() => { cleanup(); localStorage.clear(); });

describe("Goals — retirement currency by region", () => {
  it("labels the money inputs with the region symbol", () => {
    setRegion("US");
    render(<Goals currentCorpus={0} />);
    expect(screen.getByLabelText(/Invest \/ month in \$/i)).toBeTruthy();
    expect(screen.getByLabelText(/Target income \/ mo\. in \$/i)).toBeTruthy();
  });

  it("US: typing dollars stores the INR equivalent (× usdInr)", () => {
    setRegion("US", 80);
    render(<Goals currentCorpus={0} />);
    fireEvent.change(screen.getByLabelText(/Invest \/ month in \$/i), { target: { value: "1000" } });
    expect(useStore.getState().portfolio.settings.retirement?.monthlyContribution).toBe(80_000);
  });

  it("India: rupees are stored as-is (1:1)", () => {
    setRegion("India");
    render(<Goals currentCorpus={0} />);
    fireEvent.change(screen.getByLabelText(/Invest \/ month in ₹/i), { target: { value: "5000" } });
    expect(useStore.getState().portfolio.settings.retirement?.monthlyContribution).toBe(5000);
  });

  it("defaults the current age to 55", () => {
    render(<Goals currentCorpus={0} />);
    expect((screen.getByLabelText("Age now") as HTMLInputElement).value).toBe("55");
  });
});
