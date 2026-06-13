# Product Specification — Template

> Copy this file to start a new project's spec. A good spec describes **what** the product must do
> and **why**, plus the **rules** and **acceptance criteria** that decide whether it's correct — and
> leaves **how** (language, framework, file layout, libraries) to the implementer. The test of a
> finished spec: a capable engineer who has never seen your code could build a faithful version
> from it, and you could write tests directly from the "MUST" statements and acceptance criteria.
>
> **Implementation detail vs. requirement.** Technology and code structure are implementation. But a
> choice that defines the product's *promise* (e.g. "data never leaves the device") is a requirement,
> not implementation — state it, and mark it **(MUST)**. Rule of thumb: if it's observable to a user
> or a test, it belongs in the spec; if it's only how the code is organized, it doesn't.
>
> Delete this blockquote and every _italic prompt_ as you fill the section in. Cut sections that
> don't apply — a spec with empty headers is worse than a shorter, honest one.

---

## 1. Vision
_One paragraph: who it's for, what it does for them, and the single one-sentence test of success
("when X, the user can Y, and Z is true"). If you can't write the one-sentence test, the product
isn't defined yet._

## 2. Goals and non-goals
**Goals** — _the handful of outcomes that justify the project's existence. Outcomes, not features._
**Non-goals** — _things people will assume are in scope but are deliberately out. This list prevents
more scope creep than the goals list does. Say why for the surprising ones._

## 3. Users
_1–2 personas. For each: who they are, their context, what they value, what they can't/won't do.
Then "design consequences" — the concrete (MUST) rules each persona forces. Personas that don't
change a single decision are decoration; cut them._

## 4. Principles and hard constraints
_The load-bearing promises. Each is something that, if violated, is a defect rather than a trade-off.
Number them; mark the non-negotiable ones (MUST). Examples of the kinds of things that live here:
privacy/data-handling promises, determinism guarantees, "works offline," accessibility floors,
"no lock-in." Keep these technology-free — they constrain any implementation._

## 5. Domain model (conceptual)
_The core entities and how they relate, in plain prose — not a database schema. For each entity:
what it represents and its meaningful fields (illustrative names are fine). Then a "model invariants
(MUST)" list: the rules that must always hold true about the data (uniqueness, what derives from
what, what must reconcile, what must never silently change). These invariants become your hardest
tests._

## 6. Functional requirements
_Grouped by capability area, one subsection each. Describe observable behavior and the rules it must
obey — not the UI implementation. Mark constraints (MUST). Prefer "the product detects the format
itself" over "there is a dropdown to pick the format" — specify the requirement, not the widget,
unless the widget is the requirement. Cover at least: how data gets in, how it's managed/edited, the
core views/outputs, any AI/automation, and the privacy/data controls._

### 6.x <Capability area>
- _Behavior, with (MUST) on the hard rules._

## 7. Key user journeys (acceptance-level)
_The 4–8 end-to-end paths that matter most, each ending in a "Done when …" that is objectively
checkable. These are the script for your end-to-end tests and your demo. If a journey's "Done when"
is vague, the feature behind it is vague._

## 8. Derived computations / core logic
_Anything the product calculates or transforms deterministically. State each computation as
input → output and the rules. Call out any "single source of truth" and any cross-surface
consistency requirement (the same value must agree everywhere it appears). These deserve the
strongest unit tests; name the invariants so the tests can reference them._

## 9. Data boundaries / what leaves the system
_If the product handles sensitive data or talks to third parties, enumerate **exhaustively** what may
leave, to where, and under what condition — "anything not on this list is a defect." Even non-privacy
products benefit from listing external calls and their triggers. Skip only if the product is fully
self-contained._

## 10. Non-functional requirements
_Security, privacy, accessibility, performance/footprint, offline behavior, robustness/failure modes,
internationalization. For each, the concrete bar (a number or a checkable assertion), not an
aspiration. "Fast" is not a requirement; "smooth on an 8 GB laptop" is._

## 11. Distribution / deployment
_How it reaches users and runs: platforms, install/onboarding experience, signing/trust, update path,
what's public vs. private, data-format openness. State the experience bar ("trivial for a
non-technical user; no command line")._

## 12. Definition of done / quality gates
_The exact, automatable checklist that gates every change: which tests, which scans, which
cross-cutting invariants from §5 and §8, accessibility, end-to-end, regression. If it's not on this
list, it won't reliably hold. Each item should be something CI can pass or fail._

## Appendix A — Reference implementation (informative, not normative)
_The one place to record the actual technology choices, so the spec body stays implementation-free
while a reader can still map spec → code. Mark it clearly as informative: a re-implementation may
choose differently as long as the normative sections still hold._

## Appendix B — Glossary
_Define every domain term and acronym a newcomer wouldn't know. If a term needed a parenthetical the
first time you used it, it belongs here._
</content>
