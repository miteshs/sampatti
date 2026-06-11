// Cross-account duplicate detection — the CAS problem. A CAS contains EVERY mutual fund a
// user owns, so importing it alongside a platform export (Groww/Coin/AMC statement) would
// count the same funds twice. At review time we flag draft holdings that already exist in
// OTHER accounts (the Apply-to target is excluded — replacing it is the point of an update).
//
// Match strength: ISIN/symbol first (exact instrument identity), normalized name otherwise.
// "exact" = the position size matches too — almost certainly the same folio counted twice;
// a same-instrument different-size hit may legitimately be a second folio, so it's flagged
// but never auto-removed.

import type { Account, Holding, ImportDraft } from "../domain/types";

export interface DupHit {
  index: number; // index into draft.holdings
  accountId: string;
  accountName: string;
  exact: boolean;
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function findCrossAccountDuplicates(
  draft: ImportDraft,
  existingHoldings: Holding[],
  accounts: Account[],
  excludeAccountId?: string,
): DupHit[] {
  const nameById = new Map(accounts.map((a) => [a.id, a.name]));
  const hits: DupHit[] = [];
  for (let i = 0; i < draft.holdings.length; i++) {
    const d = draft.holdings[i];
    const dSym = d.symbol?.trim().toUpperCase();
    const dName = normName(d.name);
    let best: { h: Holding; exact: boolean } | null = null;
    for (const h of existingHoldings) {
      if (excludeAccountId && h.accountId === excludeAccountId) continue;
      const hSym = h.symbol?.trim().toUpperCase();
      const symMatch = !!dSym && !!hSym && dSym === hSym;
      const nameMatch = !symMatch && dName.length > 3 && normName(h.name) === dName;
      if (!symMatch && !nameMatch) continue;
      const exact =
        d.units != null && h.units != null
          ? Math.abs(d.units - h.units) <= Math.max(0.01, 0.005 * Math.abs(h.units))
          : Math.abs(d.marketValue - h.marketValue) <= 0.01 * Math.max(1, Math.abs(h.marketValue));
      if (!best || (exact && !best.exact)) best = { h, exact };
      if (best.exact) break;
    }
    if (best) {
      hits.push({
        index: i,
        accountId: best.h.accountId,
        accountName: nameById.get(best.h.accountId) ?? "another account",
        exact: best.exact,
      });
    }
  }
  return hits;
}
