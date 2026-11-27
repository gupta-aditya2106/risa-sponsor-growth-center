# RISA Sponsor Growth Center

**RISA Labs Growth APM assessment · Challenge B · Delhi NCR college fest · Aditya Gupta**

Goal: maximise sponsorship **cash collected before the fest**. The Growth Center is the working product behind the 3-slide deck. It turns each bet into a signal you can observe, each signal into a decision someone reviews, and each approved decision into a saved task. Signed promises, scheduled cash and recorded receipts stay separate throughout.

Demo: the Vercel URL is in the submission email. Static pages plus 3 serverless functions (`/api/chat`, `/api/store`, `/api/config`).

## 1. What it does

**Three modes**

| Mode | What it shows | Evidence |
|---|---|---|
| Historical 2025 | Synthetic CampusFest 2025 sponsor workbook, viewed as of the end of any chosen day (IST) | D |
| Deck plan | The frozen deck model, an ordered cash bridge, the deal mix and a scenario lab | A / I |
| Execution demo | Operational records for the five bets: offers, installments, receipts, stalls, renewals, warm intros. Simulated seed or your own entries | SIM / U |

**Four tabs, each mapped to a brief capability**

1. **Measure**
   - KPIs; brand funnel and opportunity funnel; stepwise target trend
   - Entity-level "what changed" between two dates
   - Cash calendar (Execution mode)
2. **Diagnose**
   - Campaign scorecard by route; open-proposal ageing
   - Industries and owners; the naive pooled closure scenario
   - Data quality
3. **Decide**
   - Six trigger cards using the slide-3 thresholds, each in one of five states:
     - evaluated
     - review
     - insufficient data
     - not due
     - not applicable
   - Five-bet operating cards; decision ledger (accept / override / hold, with reason and snapshot ID)
4. **Manage**
   - Task board and suggested tasks (each can be added only once)
   - Campaign edits; deal updates; interaction log; execution records
   - Monday brief export (.md); workbook upload (stage → validate → preview → adopt); workspace reset

**Always visible**

- A context strip: workspace · mode · as-of · event / T-minus · source version · rule version · honest save state.
- A **Data & definitions** drawer.
- A persistent **AI copilot** panel.

## 2. Strategy mapping

| Slide | Bet | Metric | Rule (slide 3) | Action | Screen |
|---|---|---|---|---|---|
| 2 | B1 Renew past sponsors | Renewal LOIs signed | ≤6 by T-45 stop · 7–10 change · 11–13 by T-60 plan · ≥14 scale | Move 2 heads to warm intros / leadership calls / hold / upsell a tier | Decide → B1 |
| 2 | B2 Stalls paid at booking | Stalls fully paid (cleared ≥ price) | <10 by T-45 · 20–29 at T-30 · ≥15 by T-45 · sold out by T-30 | Cut to 40 / 50-50 split / hold / +10% price | Decide → B2, Measure → cash calendar |
| 2 | B3 Cash-terms desk | Pilot gate: first 10 discount offers that cleared their advance · Collection gate: cleared ÷ signed cash-support | <2 of 10 · 40–49% · ≥50% at T-30 · ≥65% | Drop discount / branding after payment / hold / make pay-early the default | Decide → B3 (two gates) |
| 2 | B4 Goal-based packages | Top-tier offers on paper | None by T-30 · no title by T-45 · title + co-title by T-45 · second co-title | Price list + barter / split title / hold / 2 exclusives | Decide → B4 |
| 2 | B5 Warm-intro engine | Held warm meetings per complete Mon–Sun week | <4 for two weeks · 4–7 · 8–10 · ≥12 | Heads to renewals / call day / hold / propose a 6th head | Decide → B5 |
| 3 | Whole fest | Cleared sponsor + stall receipts before fest start | <₹22L · ₹22–27L · ≥₹27L at T-30 · ≥₹35L | Downsize line-up / cut a notch / hold / extras after human review | Decide → FEST |

## 3. Evidence classes

| Code | Meaning |
|---|---|
| **D** | Synthetic historical workbook |
| **I** | Interview inputs (the ₹1 Cr pre-fest obligation, tier sizes) |
| **A** | Plan / implementation assumption (TDS 0.98, shares, rule interpretations) |
| **U** | User entry in the app |
| **SIM** | Simulated execution demo (every seeded record carries `sim: true`) |

Every card is labelled with its class.

## 4. Data dictionary and semantics

**Source and storage**
- The source workbook is stored unchanged in `data/` as gzipped columnar JSON (4 parts plus a manifest) and decoded in the browser.
- `data/dataset.json` is the same content, used by the tests.

**Dates and snapshots**
- **As of D** means records with timestamp < (D + 1 day) at 00:00 local time.
- Date-only values mean that local day.
- No later record can leak into an earlier snapshot; this is tested at the 23:59:59 / 00:00:00 boundary.

**Deduplication**
- Identical payloads under one stable ID are removed: 3 interactions, 1 qualification row and 2 history rows.
- A conflicting payload under the same ID is flagged and the first occurrence is kept.

**Stage state**
- Each opportunity's state is its latest eligible full-state history row.
- History states are never summed.
- *Days in current stage* counts from the start of the latest consecutive run of the current stage. *Days since meaningful activity* counts from the latest reply, intro, inbound contact or meeting.

**Targets**
- Targets are stepwise by effective date: 20 confirmed partnerships until 14 Mar 2025, then 28 from 15 Mar 2025. The qualified-brands goal is 17 in both.

**Routes**

| Route | Campaigns |
|---|---|
| Warm introduction | SC02, SC05 |
| Inbound | SC04 (not warm) |
| Cold outbound | SC01, SC03, SC06 |

**App edits**
- In-app edits are appended as new dated rows (`applyEdits`). The source is never overwritten.

## 5. Verified baseline (as of 20 Apr 2025)

Reproduce with `npm test`.

**Activity and funnels**
- 950 recorded events and 370 outreach attempts.
- Brand funnel: 180 → 109 replied → 60 met → 45 proposal brands → 24 confirmed.
- Opportunity funnel: 58 → 46 proposals → 25 ever confirmed → 24 current. O006 was confirmed, then withdrawn.

**Value**
- Signed: ₹22,40,000 = ₹20,00,000 cash-support + ₹2,40,000 in-kind.
- Receipts: **unavailable** (never shown as ₹0).
- 14 open proposals worth ₹10,50,000.

**Activity share**
- Cold outbound accounts for 782 / 950 events (82.3% of *recorded activity share*) and 0 current wins.

**Target revision**
- On 14 Mar 2025 the count stood at 17/20.
- On 15 Mar the target became 28 with no deal change (17/28).
- Signed value on 15 Mar: ₹15,05,000.

**Naive pooled closure scenario** (timing excluded; not a forecast)
- 24/32 resolved proposals closed = 75%.

## 6. Cash definitions

| Term | Meaning |
|---|---|
| Signed value | Reported contract amount, split into cash-support and in-kind. Not cash. |
| Scheduled | Installments by due date: due before fest, overdue, due after fest (cannot fund pre-fest costs), unscheduled signed cash |
| Recorded receipts | `status = cleared` and cleared before fest start, net amounts. Pending, reversed and post-start receipts do not count. |
| Stalls | Fully paid only when cleared receipts ≥ agreed price. 50/50 splits are not fully paid until the balance clears. |
| Barter | ₹5.5L avoided spend, outside every cash total |
| Bank balance | **Not computable.** Opening balance and outflows are never recorded. |

## 7. Model arithmetic

All figures are ₹ lakh. Exact values are stored; the display rounds.

**Sponsor cash formula**

`Sponsor cash = (Top × share + Mid × share + Local × share) × 0.98`

**Scenarios**

| Scenario | Sponsor cash | Stalls | Combined |
|---|---|---|---|
| Interview reference (deck: "Today") | 25.59025 | 7.9 | **33.49025** |
| Deck base | 30.0125 | 14.5 | **44.5125** |
| Deck aim | 54.7085 | 18 | **72.7085** |
| Aim without title advance | 45.8885 | 18 | **63.8885** (−8.82) |

> **Note on the reference scenario:** the research handoff's table shows 25.58825 / 33.48825, which is a 0.002 arithmetic slip. (24.2 + 1.9125) × 0.98 = 25.59025. Both round to ₹33.5L.

**Ordered bridge** (order-dependent, not causal)

44.5125 + 12.74 (bigger mid tier) + 11.956 (cash terms + title advance) + 3.5 (stalls) = 72.7085

**Totals and deal mix**
- Aim signed total: exactly ₹102.25L.
- Deal mix vs the 2025 average of ₹0.933L: base 27 deals averaging ₹2.583L (2.77×); aim 32 deals averaging ₹3.195L (3.42×).

**Budgets**
- 0.3 + 0.6 + 2.0 + 1.5 + 1.5 = ₹5.9L allocated, plus ₹0.1L unallocated.

## 8. Rule registry

Defined in `engine.js` (`RULES`, `execAnalyse`), version `deck-v12+impl-A1`.

Published thresholds are shown verbatim. Where the slide leaves a branch unspecified, the card shows **review**, never a forced call. Milestone calls are evaluated **at the milestone date**, so later receipts cannot change a T-30 call. With no records the state is **insufficient data**, never stop.

**Interpretations (A)**

| Rule | Interpretation |
|---|---|
| B1 | T-60: ≥14 scale, 11–13 plan, 7–10 change, ≤6 review. T-45: ≤6 stop, 7–10 change, ≥14 scale, 11–13 review. |
| B2 | T-45: <10 stop, ≥15 plan, 10–14 review. T-30: sold out = scale, 20–29 change, else review. |
| B3 | Pilot gate and collection gate are evaluated separately. Collection: ≥65 scale, 50–64.9 plan, 40–49.9 change, <40 review. |
| B4 | From T-45: title + 2 co-titles scale, title + 1 plan, no title change. Nothing at all by T-30 → stop. Term sheets count. |
| B5 | Two latest complete Mon–Sun weeks. Both <4 stop; latest 4–7 change, 8–10 plan, ≥12 scale, 11 review. The current week is never counted. |
| FEST | At T-30: <22 stop, 22 ≤ x < 27 change, 27 ≤ x < 35 plan, ≥35 scale (human cash review). Whole-fest scope ignores filters. |

**Campaign heuristics** (deprioritise / scale / change / watch) are separate, configurable diagnostics. They are not the deck's governance rules.

## 9. AI implementation (`api/chat.js`)

**Inputs**
- The browser sends the question, the last 8 turns, the previous answer's entity **scope** (for "those", "that campaign"), and a snapshot built by the **same engine** as the dashboard.
- The snapshot carries its ID, mode, as-of, dataset / rule / plan versions and capability statements.

**Tools**
- Gemini (function calling) sees the summary and table schemas only.
- It must call read-only tools that run server-side over the snapshot:
  - `query_table`: filters, group_by, count / count_distinct / sum / avg / min / max, with provenance and truncation warnings.
  - `calculate`: a safe parser, no `eval`; division by zero returns "undefined".

**Answers**
- Structure: answer · evidence · calculation · interpretation · missing · next action · scope.
- The answer is marked yes / partly / no for answerability, and the snapshot ID is shown on every answer.
- The UI flags an answer when the data has changed since it was given.

**Payments and limits**
- There is no blanket refusal. Payment questions are answered from capability statements:
  - historical receipts are unavailable;
  - execution receipts are labelled SIM / U;
  - bank balance is not computable.
- Motivations, attendance uplift and tax are declared unsupported. The model gives the closest supported metric instead.

**Tasks**
- The model only **drafts** tasks. They are shown as editable previews.
- **Confirm** saves a task with an idempotency key (hash of snapshot + title + linked entity), so a double click or retry creates one task.

**Failure handling**
- Free-text fields arrive as `note_untrusted` and are treated as data.
- Model fallback order: `gemini-2.5-flash` → `gemini-flash-latest` → `gemini-2.0-flash`.
- A missing key returns a clear 503, and the dashboard keeps working.

## 10. Persistence and imports (`api/store.js`)

**Supabase** (project `jtrlanysmkwuqnntcgxx`, ap-south-1)

- Records live in `gc_ws_records (workspace_id, id, kind, data, revision)`.
- Each browser creates a random workspace UUID plus a 64-character token in localStorage; the database stores only a SHA-256 hash of the token.
- All access goes through `SECURITY DEFINER` functions: `gc_list`, `gc_put` (idempotent upsert, revision++), `gc_delete` and `gc_reset`. The anon role has no table access.
- Verified:
  - a retried put leaves one row;
  - another workspace sees 0 rows;
  - a wrong token is rejected;
  - a direct table read is blocked.

**Fallback and save state**
- If storage is unreachable, the app says **"Local only"** and keeps a browser copy.
- A failed write shows **"Save failed"**. Nothing is claimed as saved when it isn't.

**Workspace scope**
- A workspace is per browser. Clearing site data or opening another browser starts a new workspace.
- There are no accounts, so this is demo-grade isolation, not authentication.

**Uploads**
- Uploads (.xlsx via SheetJS, or .json) are staged, validated (required sheets and columns, stages, amounts, dates, orphans) and previewed against live KPIs, then adopted or discarded.
- **Reset to original** restores the shipped workbook. Workspace records are re-applied on top.

## 11. Setup

```bash
npm test                      # 49 engine + 11 API checks, writes tests/results.txt
PORT=4173 node tests/devserver.mjs   # local preview with /api
```

**Environment variables**

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes, for AI | Set in Vercel → Project → Settings → Environment Variables. Never commit it. |
| `GEMINI_MODEL` | Optional | Override the model |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Optional | Defaults point at the project above (the publishable key is public by design) |

- **Runtime:** Node ≥ 18, no build step, no npm dependencies.
- **Input format:** the original workbook's sheet and column names (see `REQUIRED` in `engine.js`).

## 12. Evaluation

| Check | How it ran | Result |
|---|---|---|
| D01–D24 dataset and semantics | Node, real workbook | Pass |
| P01–P20 plan model and rule states | Node | Pass |
| T01–T05 AI tools (aggregates, count_distinct, unknown fields, safe calc, capabilities) | Node | Pass |
| Chat loop: payment question not refused, tool steps, structured output, scope and history | **Mocked Gemini** | Pass |
| Store: credentials required, gc_put / gc_reset routing, unknown kinds rejected | **Mocked Supabase** | Pass |
| Supabase isolation (retry = 1 row, cross-workspace 0, wrong token blocked) | Live SQL on the project | Pass |
| UI smoke across all modes and tabs, decision ledger, scenario lab, task confirm | Playwright, local | Pass |
| Live Gemini answers | Deployed app | Pending: requires GEMINI_API_KEY in Vercel |

See `tests/results.txt` for the per-check list.

## 13. Sources

- RISA Labs Growth APM assignment brief (Challenge B) and the synthetic Sponsor Dataset workbook.
- The author's 3-slide deck (v12) and its interview-informed inputs:
  - the ₹1 Cr pre-fest obligation;
  - past tier sizes and collection shares;
  - renewal and stall assumptions.
- The research handoff used to specify this build.

## 14. Limits

**Data**
- The historical workbook has no receipts, invoices or spend. Cash KPIs exist only in Execution mode, from simulated or user-entered records.
- Cohorts are small (24/32 resolved; 6 campaigns). Campaign associations are not causal.

**Plan and rules**
- The plan scenarios are assumptions (A / I), not forecasts. The 75% closure scenario excludes timing.
- Rule interpretations fill gaps in the slide and are versioned, so they can be changed.

**Product**
- Demo storage is per browser with no login. The AI depends on the external Gemini API and its quota.
