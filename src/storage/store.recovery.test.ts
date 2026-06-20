// @vitest-environment jsdom
// Durability contract: a corrupt MAIN portfolio file must NOT silently wipe the user's data —
// load() recovers the last-known-good .bak and re-establishes a good main file from it. Mocks
// the platform layer to stand in for the Tauri fs (the real .bak lives on desktop only).
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyPortfolio } from "../domain/types";

const fsMock = vi.hoisted(() => ({
  raw: null as string | null, // what readPortfolioRaw returns (the MAIN file)
  bak: null as string | null, // what readPortfolioBackupRaw returns
  written: [] as string[], // everything writePortfolioRaw received
}));

vi.mock("../platform", () => ({
  isTauri: () => true,
  isIOS: () => false,
  readPortfolioRaw: async () => fsMock.raw,
  readPortfolioBackupRaw: async () => fsMock.bak,
  writePortfolioRaw: async (j: string) => { fsMock.written.push(j); },
  clearPortfolioRaw: async () => {},
  clearLocalCaches: () => {},
}));

import { useStore } from "./store";

afterEach(() => {
  fsMock.raw = null;
  fsMock.bak = null;
  fsMock.written = [];
  useStore.setState({ portfolio: emptyPortfolio(), loaded: false });
});

// A recognizable good portfolio — usdInr is an easy scalar marker to assert recovery by.
const goodPortfolio = (marker: number) => {
  const p = emptyPortfolio();
  p.settings.usdInr = marker;
  return JSON.stringify(p);
};

describe("store load() — corrupt main file recovers from backup", () => {
  it("recovers from .bak when the main file is unparseable, and rewrites a good main file", async () => {
    fsMock.raw = "{ truncated json"; // a half-written main file
    fsMock.bak = goodPortfolio(87.65);

    await useStore.getState().load();

    const s = useStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.portfolio.settings.usdInr).toBe(87.65); // came from the backup, not a clean start
    expect(fsMock.written).toHaveLength(1); // backup written back as the new main file
    expect(JSON.parse(fsMock.written[0]).settings.usdInr).toBe(87.65);
  });

  it("starts clean only when BOTH the main file and the backup are unrecoverable", async () => {
    fsMock.raw = "{ truncated";
    fsMock.bak = "{ also corrupt";

    await useStore.getState().load();

    const s = useStore.getState();
    expect(s.loaded).toBe(true);
    // Nothing salvageable → a clean (empty) portfolio, and no marker from either bad payload.
    expect(s.portfolio.accounts).toHaveLength(0);
    expect(s.portfolio.holdings).toHaveLength(0);
    expect(fsMock.written).toHaveLength(0);
  });

  it("uses the main file normally when it is valid (no backup read needed)", async () => {
    fsMock.raw = goodPortfolio(72.1);
    fsMock.bak = goodPortfolio(1); // present but must be ignored

    await useStore.getState().load();

    expect(useStore.getState().portfolio.settings.usdInr).toBe(72.1);
  });
});
