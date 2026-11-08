# End-to-end scenarios (scripted, FIXTURE PayPal gateway, fictional data)

Run: 2026-11-08T15:59:46.281Z — `npx tsx eval/scenarios.ts`. These exercise the real services and database; they are not customer results.

| Scenario | Expected | Observed | Result |
|---|---|---|---|
| 1. Complete delivery | all file requirements met, payment COMPLETED, buyer acceptance recorded | 3/3 file requirements met; payment COMPLETED; acceptance ACCEPT | PASS |
| 2. Missing item (SVG) | exactly the SVG requirement is not met and it cites the approved brief passage | not met: D2:svg; cited: "you deliver the final logo files in PNG and SVG formats" | PASS |
| 3. Ambiguous terms | approval refused while price is unknown; a participant sets it as an edit; both approve the new version | first approval: refused ("Cannot approve yet: Price and currency must be set.…"); price edited by seller -> status edited; v2 approved by both: true | PASS |
| 4. Approved change | paid v1 stays unchanged; amendment approved by both; delivery checked against the amendment (favicon now required) | paid version deadline 2026-11-20; effective v3 deadline 2026-11-24; favicon check FAIL | PASS |
