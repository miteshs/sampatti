// @vitest-environment jsdom
// Session-scoped + edit-trail behaviors added alongside the v0.8 changes:
//  - AI analysis history store actions (not persisted to the portfolio file)
//  - analysisMarkdown export rendering
//  - edit-log coalescing (one entry per field, not per keystroke)
import { beforeEach, describe, expect, it } from "vitest";
import { analysisMarkdown, useStore } from "./store";
import { emptyPortfolio } from "../domain/types";

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ portfolio: emptyPortfolio(), loaded: true, analyses: [], activeAnalysisId: null, analysisStreaming: false });
});

describe("analysisMarkdown export", () => {
  it("renders the title, a timestamp line and each non-empty turn", () => {
    const md = analysisMarkdown({
      id: "1", at: "2026-06-14T00:00:00.000Z", title: "Portfolio review", netWorth: 100,
      turns: [
        { role: "assistant", text: "You are well diversified." },
        { role: "user", text: "What about tax?" },
        { role: "assistant", text: "" }, // streaming placeholder — skipped
      ],
    });
    expect(md).toContain("# Portfolio review");
    expect(md).toContain("Sampatti AI analysis");
    expect(md).toContain("## Analysis\n\nYou are well diversified.");
    expect(md).toContain("## Your question\n\nWhat about tax?");
    expect(md.match(/## Analysis/g)?.length).toBe(1); // the empty assistant turn is dropped
  });
});

describe("AI analysis history store actions", () => {
  const s = () => useStore.getState();
  it("creates → makes active, updates turns, selects, and deletes", () => {
    const id = s().newAnalysis({ title: "Review", netWorth: 5 });
    expect(s().analyses).toHaveLength(1);
    expect(s().activeAnalysisId).toBe(id);

    s().setAnalysisTurns(id, [{ role: "assistant", text: "hi" }]);
    expect(s().analyses[0].turns[0].text).toBe("hi");

    const id2 = s().newAnalysis({ title: "Review 2", netWorth: 6 });
    expect(s().activeAnalysisId).toBe(id2); // newest becomes active
    s().selectAnalysis(id);
    expect(s().activeAnalysisId).toBe(id);

    s().deleteAnalysis(id);
    expect(s().analyses.find((a) => a.id === id)).toBeUndefined();
    expect(s().activeAnalysisId).toBeNull(); // deleting the active run clears the selection
  });

  it("never leaks the analysis history into the persisted portfolio object", () => {
    s().newAnalysis({ title: "x", netWorth: 1 });
    expect((s().portfolio as unknown as Record<string, unknown>).analyses).toBeUndefined();
  });
});

describe("edit-log coalescing", () => {
  const s = () => useStore.getState();
  it("collapses a per-keystroke rename into ONE entry (original → final)", () => {
    const id = s().addAccount({ name: "E", institution: "", accountType: "demat", taxTreatment: "taxable", region: "India", currency: "INR" });
    s().editAccount(id, { name: "Et" });
    s().editAccount(id, { name: "Etr" });
    s().editAccount(id, { name: "Etrade" });
    const nameEdits = s().portfolio.edits.filter((e) => e.field === "name" && e.entityId === id);
    expect(nameEdits).toHaveLength(1);
    expect(nameEdits[0].from).toBe("E");
    expect(nameEdits[0].to).toBe("Etrade");
  });

  it("drops the entry entirely when a field is edited back to its starting value", () => {
    const id = s().addAccount({ name: "House", institution: "", accountType: "real_estate", taxTreatment: "taxable", region: "India", currency: "INR" });
    s().editAccount(id, { institution: "HDFC" });
    s().editAccount(id, { institution: "" }); // back to original
    expect(s().portfolio.edits.some((e) => e.field === "institution")).toBe(false);
  });
});
