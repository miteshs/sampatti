// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "./store";
import { emptyPortfolio } from "../domain/types";

afterEach(() => {
  localStorage.clear();
  useStore.setState({ portfolio: emptyPortfolio(), loaded: false });
});

describe("store load() — relay URL self-heal on upgrade", () => {
  it("backfills an empty relay URL from the current default", async () => {
    // A portfolio saved before the relay default existed stores relayUrl: "".
    const saved = emptyPortfolio();
    saved.settings.relayUrl = "";
    localStorage.setItem("sampatti.portfolio", JSON.stringify(saved));

    await useStore.getState().load();

    const url = useStore.getState().portfolio.settings.relayUrl;
    expect(url).toBe(emptyPortfolio().settings.relayUrl);
    expect(url).toMatch(/^https:\/\//);
  });

  it("preserves a user-set custom relay URL", async () => {
    const saved = emptyPortfolio();
    saved.settings.relayUrl = "https://my-own-relay.workers.dev";
    localStorage.setItem("sampatti.portfolio", JSON.stringify(saved));

    await useStore.getState().load();

    expect(useStore.getState().portfolio.settings.relayUrl).toBe("https://my-own-relay.workers.dev");
  });

  it("keeps newer saved settings while filling in any newly-added defaults", async () => {
    // Simulate an older save missing a field added later (analysisModel).
    const saved = emptyPortfolio() as unknown as Record<string, unknown>;
    (saved.settings as Record<string, unknown>).analysisModel = undefined;
    delete (saved.settings as Record<string, unknown>).analysisModel;
    localStorage.setItem("sampatti.portfolio", JSON.stringify(saved));

    await useStore.getState().load();

    // The default model is filled in rather than left undefined.
    expect(useStore.getState().portfolio.settings.analysisModel).toBe(emptyPortfolio().settings.analysisModel);
  });
});
