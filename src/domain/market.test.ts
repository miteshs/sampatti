import { describe, expect, it } from "vitest";
import { parseYahoo, parseMfapi, parseAmfiIsinMap, yahooSymbolFor } from "./market";
import type { Holding } from "./types";

const hold = (p: Partial<Holding>): Holding => ({
  id: "h", accountId: "a", name: "H", assetClass: "indian_equity", marketValue: 100, currency: "INR", ...p,
});

describe("parseYahoo", () => {
  it("builds an ascending series and skips null closes", () => {
    const json = {
      chart: { result: [{ timestamp: [1700000000, 1700086400, 1700172800], indicators: { quote: [{ close: [100, null, 110] }] } }] },
    };
    const s = parseYahoo(json);
    expect(s.map((p) => p.price)).toEqual([100, 110]); // null dropped
    expect(s[0].t).toBe(1700000000 * 1000);
  });
  it("returns empty for a malformed payload", () => expect(parseYahoo({})).toEqual([]));
});

describe("parseMfapi", () => {
  it("parses dd-mm-yyyy NAVs into an ascending series", () => {
    const json = { data: [{ date: "07-06-2026", nav: "120.50" }, { date: "06-06-2026", nav: "119.00" }] };
    const s = parseMfapi(json);
    expect(s.map((p) => p.price)).toEqual([119, 120.5]); // sorted ascending by date
  });
});

describe("parseAmfiIsinMap", () => {
  it("maps both ISIN columns to the scheme code, ignoring headers/AMC lines", () => {
    const txt = [
      "Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date",
      "Some AMC Mutual Fund",
      "120503;XX0000000001;XX0000000002;Sample Growth;456.78;07-Jun-2026",
      ";;;;;",
    ].join("\n");
    const m = parseAmfiIsinMap(txt);
    expect(m.get("XX0000000001")).toBe("120503");
    expect(m.get("XX0000000002")).toBe("120503");
    expect(m.size).toBe(2);
  });
});

describe("yahooSymbolFor", () => {
  it("suffixes Indian equities with .NS", () => expect(yahooSymbolFor(hold({ symbol: "RELIANCE", assetClass: "indian_equity" }))).toBe("RELIANCE.NS"));
  it("uses US tickers as-is", () => expect(yahooSymbolFor(hold({ symbol: "AAPL", assetClass: "us_equity", currency: "USD" }))).toBe("AAPL"));
  it("maps gold to the GC=F future", () => expect(yahooSymbolFor(hold({ assetClass: "gold_other", units: 50 }))).toBe("GC=F"));
  it("treats USD index ETFs as listed, INR ones as not (those go to mfapi)", () => {
    expect(yahooSymbolFor(hold({ symbol: "VTI", assetClass: "index_etf", currency: "USD" }))).toBe("VTI");
    expect(yahooSymbolFor(hold({ symbol: "INF200K01XXX", assetClass: "index_etf", currency: "INR" }))).toBeNull();
  });
  it("returns null for an ISIN-only equity (no ticker)", () => expect(yahooSymbolFor(hold({ symbol: "INE002A01018", assetClass: "indian_equity" }))).toBeNull());
  it("returns null when there's no symbol", () => expect(yahooSymbolFor(hold({ symbol: "", assetClass: "us_equity" }))).toBeNull());
});
