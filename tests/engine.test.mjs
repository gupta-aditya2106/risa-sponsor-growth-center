// Acceptance tests for the shared engine (handoff D01–D24, P01–P20 where they are engine-testable).
import fs from 'fs';
import assert from 'assert';
import * as E from '../engine.js';
const S = JSON.parse(fs.readFileSync(new URL('../data/dataset.json', import.meta.url))).sheets;
let pass = 0; const results = [];
const t = (id, name, fn) => { fn(); pass++; results.push(`${id} ok - ${name}`); console.log('ok -', id, name); };
const close = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const d = E.defaultDate(S); const a = E.analyse(S, d); const k = a.kpis;
t('D01', 'default as-of is history end 2025-04-20; cutoff is next local midnight', () => { assert.equal(d, '2025-04-20'); assert.equal(k.cutoff_exclusive, '2025-04-21T00:00:00'); });
t('D02', 'exact duplicates removed: 3 interaction, 1 qualification, 2 history', () => assert.deepEqual(a.quality.slice(1, 4).map(q => q.value), [3, 1, 2]));
t('D03', '950 recorded events, 370 attempts', () => { assert.equal(k.recorded_events, 950); assert.equal(k.outreach_attempts, 370); });
t('D04', 'brand funnel 180 → 109 → 60 → 45 → 24 (cohort)', () => assert.deepEqual(a.brandFunnel.map(f => f.value), [180, 109, 60, 45, 24]));
t('D05', 'opportunity funnel 58 → 46 → 25 → 24', () => assert.deepEqual(a.oppFunnel.map(f => f.value), [58, 46, 25, 24]));
t('D06', '46 proposal opportunities vs 45 proposal brands', () => { assert.equal(k.proposal_opportunities, 46); assert.equal(k.proposal_brands, 45); });
t('D07', '25 ever confirmed vs 24 current; O006 withdrawn after confirming', () => { assert.equal(k.ever_confirmed, 25); assert.equal(k.current_confirmed, 24); assert.equal(k.withdrawn_after_confirming[0].id, 'O006'); });
t('D08', 'signed ₹22.4L = ₹20L cash-support + ₹2.4L in-kind', () => { assert.equal(k.signed_value_inr, 2240000); assert.equal(k.signed_cash_support_inr, 2000000); assert.equal(k.signed_in_kind_inr, 240000); });
t('D09', 'receipts unavailable, never ₹0', () => { assert.equal(k.receipts_status, 'unavailable'); assert.ok(!('cash_received_inr' in k)); });
t('D10', '14 open proposals worth ₹10.5L', () => { assert.equal(k.open_proposals, 14); assert.equal(k.open_proposal_value_inr, 1050000); });
t('D11', 'cold outbound recorded activity share 782/950 = 82.3% with 0 wins', () => { assert.equal(k.cold_outbound_events, 782); assert.equal(k.cold_outbound_activity_share_pct, 82.3); assert.equal(k.cold_outbound_current_wins, 0); });
t('D12', 'SC04 is inbound, not warm introduction', () => assert.equal(a.byCampaign.find(c => c.campaign_id === 'SC04').route, 'inbound'));
t('D13', 'target stepwise: 20 on 14 Mar, 28 on 15 Mar', () => { assert.equal(E.analyse(S, '2025-03-14').kpis.target_confirmed, 20); assert.equal(E.analyse(S, '2025-03-15').kpis.target_confirmed, 28); });
t('D14', 'what changed 14→15 Mar: target revision 17/20 → 17/28 is an entity item with no deal change', () => {
  const c = E.compareSnapshots(E.analyse(S, '2025-03-14'), E.analyse(S, '2025-03-15'));
  const tc = c.items.find(i => i.type === 'target change'); assert.ok(tc); assert.ok(/20 → 28/.test(tc.detail));
  const k15 = E.analyse(S, '2025-03-15').kpis; assert.equal(k15.confirmed_vs_target, '17/28'); assert.equal(k15.signed_value_inr, 1505000); });
t('D15', 'what changed reconciles signed-value change to entity items', () => { const c = E.compareSnapshots(E.analyse(S, '2025-03-01'), a); assert.equal(c.reconciliation.signed_value_change_inr, c.reconciliation.explained_by_items_inr); });
t('D16', 'no leakage: 2025-02-20 snapshot has no later records', () => { const e = E.analyse(S, '2025-02-20'); assert.ok(e.events.every(x => x.occurred_at < '2025-02-21')); assert.ok(e.kpis.current_confirmed < 24); });
t('D17', 'O006 confirmed (not withdrawn) as of 2025-03-01', () => assert.equal(E.analyse(S, '2025-03-01').oppRows.find(o => o.opportunity_id === 'O006').stage, 'partner_confirmed'));
t('D18', 'boundary: a record at 23:59:59 counts, one at next midnight does not', () => {
  const copy = structuredClone(S); const base = copy['Sponsor interactions'][0];
  copy['Sponsor interactions'].push({ ...base, interaction_id: 'TX1', occurred_at: '2025-04-20T23:59:59' }, { ...base, interaction_id: 'TX2', occurred_at: '2025-04-21T00:00:00' });
  assert.equal(E.analyse(copy, d).kpis.recorded_events, 951); });
t('D19', 'conflicting payload under one ID is flagged, not silently kept twice', () => {
  const copy = structuredClone(S); copy['Sponsor interactions'].push({ ...copy['Sponsor interactions'][5], summary: 'changed' });
  const e = E.analyse(copy, d); assert.equal(e.kpis.recorded_events, 950); assert.equal(e.conflicts.length, 1); });
t('D20', 'in-app deal update flows through as a new dated record', () => {
  const o = a.open[0]; const S2 = E.applyEdits(S, [{ id: 'u1', kind: 'opp_update', data: { opportunity_id: o.opportunity_id, brand_id: o.brand_id, brand_name: o.brand, stage: 'partner_confirmed', proposed_value_inr: o.proposed_inr, confirmed_value_inr: o.proposed_inr, at: '2025-04-20T23:10:00' } }]);
  const e = E.analyse(S2, d); assert.equal(e.kpis.current_confirmed, 25); assert.equal(e.kpis.signed_value_inr, 2240000 + o.proposed_inr);
  assert.equal(E.analyse(S2, '2025-04-19').kpis.current_confirmed, E.analyse(S, '2025-04-19').kpis.current_confirmed); });
t('D21', 'naive pooled closure scenario 24/32 = 75%, labelled timing-excluded', () => { assert.equal(a.naive.pooled_rate_pct, 75); assert.equal(a.naive.resolved_sample, '24/32'); assert.ok(/timing excluded/.test(a.naive.label)); });
t('D22', 'cost per win undefined with 0 wins; spend unknown until entered', () => {
  const sc01 = a.byCampaign.find(c => c.campaign_id === 'SC01'); assert.equal(sc01.spent_inr, null); assert.equal(sc01.cost_per_current_win_inr, null);
  const e = E.analyse(S, d, { meta: { campaigns: { [sc01.campaign]: { spent_inr: 50000 } } } }); assert.equal(e.byCampaign.find(c => c.campaign_id === 'SC01').cost_per_current_win_inr, 'undefined (0 wins)'); });
t('D23', 'upload validation rejects a missing sheet and unknown stages', () => {
  const bad = structuredClone(S); delete bad.Targets; assert.equal(E.validateSheets(bad).ok, false);
  const bad2 = structuredClone(S); bad2['Opportunity history'][0].stage = 'won'; assert.equal(E.validateSheets(bad2).ok, false);
  assert.equal(E.validateSheets(S).ok, true); });
t('D24', 'snapshot ID changes with as-of, overlay revision and mode', () => {
  const b = { workspace: 'w', dataset: 'd', overlayRevision: 1, asOf: d, mode: 'historical' };
  const ids = new Set([E.snapshotId(b), E.snapshotId({ ...b, asOf: '2025-04-19' }), E.snapshotId({ ...b, overlayRevision: 2 }), E.snapshotId({ ...b, mode: 'execution' })]);
  assert.equal(ids.size, 4); });

// Plan model
t('P01', 'base 44.5125, aim 72.7085, aim without title advance 63.8885 (−8.82)', () => {
  close(E.cashModel(E.SCENARIOS.base).combined_cash_l, 44.5125); close(E.cashModel(E.SCENARIOS.aim).combined_cash_l, 72.7085);
  close(E.cashModel(E.SCENARIOS.aim_no_advance).combined_cash_l, 63.8885); close(72.7085 - 63.8885, 8.82); });
t('P02', 'bridge 44.5125 + 12.74 + 11.956 + 3.5 = 72.7085', () => { const s = E.bridge().steps.map(x => x.value_l); close(s[1], 12.74); close(s[2], 11.956); close(s[3], 3.5); close(s[0] + s[1] + s[2] + s[3], s[4]); close(s[4], E.bridge().check_l); });
t('P03', 'budgets 0.3/0.6/2.0/1.5/1.5 = 5.9 + 0.1 unallocated', () => { assert.deepEqual(E.BETS.map(b => b.budget_l), [0.3, 0.6, 2, 1.5, 1.5]); close(E.BUDGET.allocated_l, 5.9); close(E.BUDGET.unallocated_l, 0.1); });
t('P04', 'aim signed exactly ₹102.25L; deal mix 2.77× / 3.42× historical', () => { const m = E.dealMix(k.average_signed_deal_inr); close(m.aim.value_l, 102.25); assert.equal(m.base.multiple_of_historical.toFixed(2), '2.77'); assert.equal(m.aim.multiple_of_historical.toFixed(2), '3.42'); });
t('P05', 'reference scenario labelled as interview reference (deck: Today)', () => assert.ok(/Interview reference scenario \(deck: "Today"\)/.test(E.SCENARIOS.reference.label)));

// Execution rules
const FEST = '2027-02-26'; const recs = E.demoExecutionRecords(FEST); const ST = { fest_date: FEST, stall_capacity: 60 };
const ex = (date, r = recs) => E.execAnalyse(r, ST, date);
const rule = (x, bet, gate) => x.rules.find(r => r.bet === bet && (!gate || r.gate === gate));
t('P06', 'every rule is "not due" or insufficient far before the fest', () => { const x = ex('2026-11-27'); x.rules.forEach(r => assert.ok(/not due|insufficient|no stop/.test(r.state) || r.bet === 'B5', r.bet + ' ' + r.state)); });
t('P07', 'no records → insufficient data, never stop', () => { const x = E.execAnalyse([], ST, '2027-01-28'); x.rules.forEach(r => { assert.notEqual(r.call, 'stop'); }); assert.equal(rule(x, 'FEST').state, 'insufficient data'); assert.equal(x.kpis.combined_receipts_cleared_inr, null); });
t('P08', 'B1 at T-45 with 11 LOIs → review (no published branch)', () => { const r = rule(ex('2027-01-28'), 'B1'); assert.equal(r.value, 11); assert.equal(r.state, 'review'); });
t('P09', 'B2 at T-30 with 22 fully paid → change; 50/50 splits are not fully paid', () => { const x = ex('2027-01-28'); assert.equal(rule(x, 'B2').call, 'change'); assert.equal(x.kpis.stalls_fully_paid, 22); });
t('P10', 'B3 pilot and collection gates are separate', () => { const x = ex('2027-01-28'); assert.ok(rule(x, 'B3', 'pilot')); assert.ok(rule(x, 'B3', 'collection')); });
t('P11', 'B3 collection: below 40% → review, not stop', () => { const r = rule(ex('2027-01-28'), 'B3', 'collection'); assert.ok(r.value < 40); assert.equal(r.state, 'review'); assert.equal(r.call, null); });
t('P12', 'B4 title + 2 co-titles (term sheet counts) → scale', () => assert.equal(rule(ex('2027-01-28'), 'B4').call, 'scale'));
t('P13', 'B5 uses complete weeks only; current week excluded', () => { const r = rule(ex('2027-01-28'), 'B5'); assert.ok(/not counted/.test(r.window)); });
t('P14', 'FEST gate ₹25.63L at T-30 → change; whole-fest scope', () => { const r = rule(ex('2027-01-28'), 'FEST'); close(r.value, 25.63); assert.equal(r.call, 'change'); assert.ok(/whole fest/.test(r.scope)); });
t('P15', 'FEST boundary: exactly ₹27L → plan', () => {
  const extra = [...recs, { id: 'x1', kind: 'receipt', data: { category: 'stall', amount_inr: 137000, cleared_date: '2027-01-20', status: 'cleared' } }];
  close(rule(ex('2027-01-28', extra), 'FEST').value, 27); assert.equal(rule(ex('2027-01-28', extra), 'FEST').call, 'plan'); });
t('P16', 'pending receipts and receipts after fest start do not count', () => {
  const extra = [...recs, { id: 'x2', kind: 'receipt', data: { category: 'sponsor', amount_inr: 999999, cleared_date: '2027-01-20', status: 'pending' } }, { id: 'x3', kind: 'receipt', data: { category: 'sponsor', amount_inr: 888888, cleared_date: FEST, status: 'cleared' } }];
  assert.equal(ex('2027-03-01', extra).kpis.sponsor_receipts_cleared_inr, ex('2027-03-01').kpis.sponsor_receipts_cleared_inr); });
t('P17', 'cash calendar separates overdue, due before fest, due after fest', () => { const x = ex('2027-01-28').kpis; assert.ok(x.overdue_inr > 0); assert.ok(x.due_after_fest_inr > 0); assert.ok(x.due_before_fest_remaining_inr > 0); });
t('P18', 'milestone evaluated at the milestone date: later receipts do not change a T-30 call', () => {
  const extra = [...recs, { id: 'x4', kind: 'receipt', data: { category: 'stall', amount_inr: 2000000, cleared_date: '2027-01-28', status: 'cleared' } }];
  assert.equal(rule(ex('2027-01-28', extra), 'FEST').call, 'change'); });
t('P19', 'all demo records are marked sim', () => assert.ok(recs.every(r => r.data.sim === true)));
t('P20', 'decision brief contains snapshot, rule table and evidence classes', () => {
  const md = E.decisionBrief({ a, exec: ex('2027-01-28'), tasks: [{ title: 'x', status: 'todo' }], decisions: [], snapshot_id: 'snap-x', mode: 'execution' });
  assert.ok(md.includes('snap-x') && md.includes('| B2') && md.includes('SIM simulated')); });

// AI tools
const snap = E.snapshotForAI(a, { mode: 'historical', snapshot_id: 'snap-t' });
t('T01', 'runQuery aggregates over the full table, not a truncated subset', () => { const r = E.runQuery(snap, { table: 'opportunities', where: [{ field: 'stage', op: 'eq', value: 'partner_confirmed' }], aggregates: [{ op: 'sum', field: 'confirmed_inr', as: 'v' }, { op: 'count' }] }); assert.equal(r.results.v, 2240000); assert.equal(r.results.count_rows, 24); assert.equal(r.scope.snapshot_id, 'snap-t'); });
t('T02', 'runQuery count_distinct brands with proposals = 45', () => { const r = E.runQuery(snap, { table: 'opportunities', where: [{ field: 'ever_proposal_sent', op: 'eq', value: 'true' }], aggregates: [{ op: 'count_distinct', field: 'brand_id', as: 'b' }] }); assert.equal(r.results.b, 45); });
t('T03', 'runQuery rejects unknown fields and tables with the supported list', () => { assert.ok(E.runQuery(snap, { table: 'nope' }).supported_tables); assert.ok(E.runQuery(snap, { table: 'opportunities', where: [{ field: 'xx', op: 'eq', value: 1 }] }).supported_fields); });
t('T04', 'calculate is exact and safe', () => { assert.equal(E.calculate('(24 / 28) * 100').result, 85.714286); assert.ok(E.calculate('process.exit()').error); assert.equal(E.calculate('5/0').result, null); });
t('T05', 'snapshot states capabilities for unavailable data', () => { assert.ok(/unavailable/.test(snap.capabilities.historical_receipts)); assert.ok(/not computable/.test(snap.capabilities.bank_balance)); });

fs.writeFileSync(new URL('./results.txt', import.meta.url), results.join('\n') + `\n${pass} passed\n`);
console.log(`\n${pass} engine checks passed`);
