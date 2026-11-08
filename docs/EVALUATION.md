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

### Claude (`claude-opus-5-5`, effort low, structured output) — 8 Nov 2026

**Run 1 (as built)** — `eval/results/anthropic-2026-11-08T16-23-20-968Z.json`

| Split | Briefs | Precision | Recall | Wrong facts kept | Invalid quotes | Claims dropped | Ambiguity flagged | AI questions on clean briefs | Mean latency | Cost (list price) |
|---|---|---|---|---|---|---|---|---|---|---|
| Tuning | 4 | 1.000 | 0.960 | 0 | 0 / 24 | 3 | 2 / 2 | 3 | 4.0 s | $0.080 |
| Held-out | 6 | 1.000 | 0.938 | 0 | 0 / 41 | 4 | 8 / 8 | 1 | 5.3 s | $0.129 |
| All | 10 | 1.000 | 0.947 | 0 | 0 / 65 | 7 | 10 / 10 | 4 | 4.8 s | $0.209 (29,161 in / 4,594 out tokens) |

What the validator dropped in run 1: quantity "1" inferred from "a"/"the" (3×, conservative misses), an unsupported format name `html`, the INR price (correct: PayPal India cannot receive domestic payments), and **one false rejection**: "6 PM Eastern" → `America/New_York` was dropped because the validator did not recognise "Eastern" as a timezone word.

**Fix after seeing a held-out result:** the validator now accepts US zone words (eastern, central, mountain, pacific); unit test added. Because this change was prompted by a held-out brief (H2), H2 is no longer a clean held-out item for that rule.

**Run 2 (after the fix)** — `eval/results/anthropic-2026-11-08T16-25-10-122Z.json`: precision 1.000, recall 0.965 (held-out 0.969), 0 wrong facts kept, 0 / 64 invalid quotes, ambiguity 10 / 10, 5 AI questions on clean briefs, mean latency 5.3 s, $0.215. Run-to-run differences also include normal model variance (single run each; no repeated-sampling statistics).

**Reading these numbers:** on ten short, fictional, hand-labelled briefs, Claude plus the quote validator kept no wrong values and asked about every labelled ambiguity; the misses are conservative (values left unknown). Ten briefs written by the same person who built the system is a tiny, biased sample. It does not predict performance on real client conversations.

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
