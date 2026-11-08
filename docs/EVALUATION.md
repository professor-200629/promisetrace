# Evaluation

> **Synthetic benchmark.** Ten fictional briefs written and labelled by the author. This measures extraction behaviour on made-up text. It is **not** customer validation, and it says nothing about savings, chargebacks or demand.

## Dataset (`eval/dataset.ts`)

- 4 **tuning** briefs (written first, used while shaping the prompt and the validator): clean logo brief, vague landing page, banners with counts across messages, prompt injection.
- 6 **held-out** briefs (written afterwards, not used for tuning): clean icon set (GBP/London), conflicting prices, INR price, "a couple of concepts" with unstated formats, quantity changed later in the thread, no price at all.
- Each label has: price (minor units + currency) or none, deadline date/time/IANA timezone, revision rounds, deliverables (quantity + formats), and the fields where the right behaviour is to **ask** rather than guess.

## Metrics (`eval/run-eval.ts`)

- **Facts**: price, deadline date, time, timezone, revision count, each deliverable format, each deliverable quantity.
- **Precision** = correct kept facts / kept facts. **Recall** = correct kept facts / labelled facts. Deliverables are matched greedily by format overlap.
- **Wrong facts kept**: values that passed validation but are wrong (the dangerous kind).
- **Invalid quotes**: model quotes that do not exist in the source. **Claims dropped**: values the validator removed for lack of a supporting passage.
- **Ambiguity flagged**: of the fields labelled ambiguous, how many were left unknown / needs-clarification or questioned.
- Latency, tokens and estimated cost (list price from `.env`).

## Results

### Rule-based baseline (FIXTURE extractor, not AI) — run 8 Nov 2026

`npx tsx eval/run-eval.ts --provider fixture` → `eval/results/fixture-2026-11-08T15-58-51-182Z.json`

| Split | Briefs | Precision | Recall | Wrong facts kept | Invalid quotes | Claims dropped | Ambiguity flagged |
|---|---|---|---|---|---|---|---|
| Tuning | 4 | 0.941 | 0.640 | 1 | 0 / 13 | 0 | 2 / 2 |
| Held-out | 6 | 0.815 | 0.688 | 5 | 0 / 20 | 1 | 7 / 8 |
| All | 10 | 0.864 | 0.667 | 6 | 0 / 33 | 1 | 9 / 10 |

The baseline quotes whole sentences, so its quotes always exist; its errors are wrong values from the right sentence (for example the concepts date taken as the final deadline) and missed facts.

### Claude (`claude-opus-5-5`, effort low) — **not run yet**

Run with `npm run eval -- --provider anthropic` once `ANTHROPIC_API_KEY` is set. Expected cost at list price is a few cents per brief; the script logs the actual tokens and cost. Results will be added here unedited, including failures.

## End-to-end scenarios (`eval/scenarios.ts`)

4/4 pass on 8 Nov 2026 (FIXTURE PayPal gateway): complete delivery, missing item, ambiguous terms, approved change after payment. Table: `eval/results/scenarios.md`.

## Time to assemble an evidence record: manual vs PromiseTrace (protocol — **not run**)

Goal: compare how long it takes to assemble the same evidence record for the demo transaction.

- **Task**: produce a record containing the agreed requirements with the source sentence for each, PayPal order and capture IDs with status and amount, every delivered file with time received and SHA-256, the buyer's statements, and which requirements were met.
- **Manual arm**: participant gets the email thread, a PayPal sandbox transaction page, the delivered files and the buyer's messages; they build the record in a document of their choice (hashes with `certutil -hashfile <file> SHA256` or `shasum -a 256`).
- **App arm**: same materials; they run the transaction through PromiseTrace and export the HTML record.
- **Measure**: wall-clock minutes from start to a record that passes a checklist of the 6 items above; count checklist misses.
- **Sample**: at least 5 people, randomised order of arms, a second fictional transaction for the second arm to limit learning effects.
- **Log**: date, participant role (not name), arm, minutes, misses, notes. No results are reported until the study is actually run.

## What would count as real-world evidence

Interviews (`docs/INTERVIEW_SCRIPT.md`) and a pilot (`docs/PILOT_HYPOTHESIS.md`). Neither has been done.
