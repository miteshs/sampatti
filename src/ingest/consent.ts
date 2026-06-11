// Decides what happens after a file pick BEFORE anything runs: parse straight away (nothing
// leaves the device), show the consent card (something goes to Claude), or — local engine
// chosen with no model on disk — ask the user to download it or use Claude this once.
// Pure so the whole matrix is unit-testable; AddData supplies the engine and model state.

import type { AiEngine } from "../domain/types";
import type { IngestKind } from "./index";

export type BatchPlan = "run" | "confirm" | "model-missing";

export function planBatch(classes: IngestKind[], engine: AiEngine, modelReady: boolean): BatchPlan {
  const ai = classes.filter((c) => c !== "local");
  if (ai.length === 0) return "run"; // deterministic parsers only — no gate ever
  if (engine !== "local") return "confirm"; // Claude engine: anything AI-bound needs consent
  // Local engine. Text files run on-device — but only if the model is actually there.
  if (ai.includes("ai-text") && !modelReady) return "model-missing";
  // Images always use Claude (on-device models can't read dense statements), so they
  // still need the consent card even when everything else stays local.
  return ai.includes("ai-image") ? "confirm" : "run";
}

// Which of a gated batch's files actually leave the device. Under the local engine that is
// only the images; under Claude it is every AI-bound file. Drives the consent-card copy.
export function filesForClaude<T>(files: T[], classify: (f: T) => IngestKind, engine: AiEngine): T[] {
  return files.filter((f) => (engine === "local" ? classify(f) === "ai-image" : classify(f) !== "local"));
}
