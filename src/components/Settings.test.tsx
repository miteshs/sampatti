// @vitest-environment jsdom
// The About footer at the bottom of Settings: version (from package.json via __APP_VERSION__),
// the educational-use disclaimer, and a copyright line.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useStore } from "../storage/store";
import { emptyPortfolio } from "../domain/types";
import { Settings } from "./Settings";

beforeEach(() => useStore.setState({ portfolio: emptyPortfolio(), loaded: true }));
afterEach(() => { cleanup(); localStorage.clear(); });

describe("Settings — About footer", () => {
  it("shows the app version from package.json", () => {
    render(<Settings />);
    expect(document.body.textContent).toContain(`v${__APP_VERSION__}`);
    expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+$/); // sanity: define is wired
  });

  it("shows the educational-use disclaimer and a copyright line", () => {
    render(<Settings />);
    expect(screen.getByText(/educational and personal use only/i)).toBeTruthy();
    expect(screen.getByText(/©\s*\d{4}\s*Sampatti/)).toBeTruthy();
  });
});
