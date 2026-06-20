// Shared option lists + helpers for the Add-Data sub-forms. Kept in one place so the draft-review
// card, the manual-entry form, and the income form all read the same enumerations.
import { ACCOUNT_TYPE_LABEL, ASSET_CLASS_LABEL, TAX_LABEL } from "../../domain/classify";
import type { AccountType, AssetClass, IncomeKind, Region, TaxTreatment } from "../../domain/types";

export const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[];
export const ASSET_CLASSES = Object.keys(ASSET_CLASS_LABEL) as AssetClass[];
export const TAX_TYPES = Object.keys(TAX_LABEL) as TaxTreatment[];
export const REGIONS: Region[] = ["India", "US", "Other"];
export const INCOME_KINDS: IncomeKind[] = ["salary", "rent", "business", "dividend", "interest", "other"];

export const isGold = (c: AssetClass) => c === "gold_sgb" || c === "gold_other";
