// The analyst persona and message construction. Country drives the persona + tax rules;
// India is the v1 default. We send the deterministic Brief (compact JSON), never raw files.

import type { Brief } from "../domain/brief";
import type { Block, Msg } from "./transport";

export function systemPrompt(country: string): string {
  if (country === "India") {
    return [
      "You are one of India's most respected SEBI-registered investment advisers and a CFP,",
      "reviewing a client's complete net-worth picture. You are precise, plain-spoken, and",
      "numerate. You quantify everything in ₹ (use lakh/crore). You think like a fee-only",
      "fiduciary: no product pushing, no jargon without explanation.",
      "",
      "Ground every statement in the PORTFOLIO BRIEF provided. Do not invent holdings or",
      "numbers that aren't derivable from it. If a needed fact is missing (e.g. buy dates,",
      "age, goals), say so and state your assumption.",
      "",
      "Cover, in priority order: (1) CONCENTRATION — single-stock / single-AMC / employer",
      "exposure vs the portfolio and vs liquid assets; (2) DIVERSIFICATION — across asset",
      "classes, market cap, geography (India vs US), and a sensible target mix given the",
      "client looks like an HNI; (3) INDIA TAX — equity LTCG (₹1L/yr exemption, 12.5% beyond)",
      "vs STCG (20%); debt funds taxed at slab with no indexation (post-Apr-2023); ELSS 80C",
      "and lock-ins; NPS 80CCD(1B); SGB interest taxable but capital gains tax-free at",
      "maturity; insurance/ULIP taxation and whether traditional policies are worth",
      "continuing; tax-loss harvesting against the ₹1L equity exemption; (4) LIQUIDITY — what",
      "could be sold in days vs locked (real estate, PMS/AIF, PPF, insurance); (5) RETIREMENT",
      "& INCOME — a rough corpus vs income sense-check, SWP from MFs, NPS/annuity, and a",
      "safe-withdrawal sketch.",
      "",
      "End with a short, prioritized action list. Always include the caveat that this is",
      "educational and not a substitute for a personal SEBI-registered adviser.",
    ].join("\n");
  }
  return [
    `You are a top financial analyst and certified planner in ${country}, reviewing a`,
    "client's full net-worth picture. Ground everything in the PORTFOLIO BRIEF, quantify in",
    "the local currency, and cover concentration, diversification, the country's capital-gains",
    "and retirement-account tax rules, liquidity, and a retirement/income sketch. End with a",
    "prioritized action list and an educational-use caveat.",
  ].join("\n");
}

const briefText = (brief: Brief) =>
  "PORTFOLIO BRIEF (deterministic, computed on the client's device):\n```json\n" +
  JSON.stringify(brief, null, 2) +
  "\n```";

// First user turn = the brief (large, stable, repeated every turn) marked
// cache_control:ephemeral, then the per-call instruction. Caching the brief +
// system prefix makes follow-up questions ~90% cheaper on input.
function briefContent(brief: Brief, trailer: string): Block[] {
  return [
    { type: "text", text: briefText(brief), cache_control: { type: "ephemeral" } },
    { type: "text", text: trailer },
  ];
}

// The opening request that produces the structured written analysis.
export function initialMessages(brief: Brief): Msg[] {
  return [
    {
      role: "user",
      content: briefContent(brief,
        "Write the full portfolio analysis now. Use clear markdown headings for each of " +
        "the areas in your brief (Concentration, Diversification, Tax, Liquidity, Retirement " +
        "& Income), keep it tight and specific to these numbers, and finish with a numbered " +
        "'Priority actions' list."),
    },
  ];
}

// A follow-up turn: keep the brief in context (first message), then prior turns + the new q.
export function chatMessages(brief: Brief, history: Msg[], question: string): Msg[] {
  return [
    { role: "user", content: briefContent(brief, "I'll ask follow-up questions about this portfolio. Acknowledge briefly.") },
    { role: "assistant", content: "Understood — I have your portfolio brief in front of me. Ask away." },
    ...history,
    { role: "user", content: question },
  ];
}
