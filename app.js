import * as E from '/engine.js';
const { analyse, applyEdits, defaultDate, compareSnapshots, execAnalyse, demoExecutionRecords, snapshotForAI, snapshotId, decisionBrief, validateSheets, datasetVersion,
  SCENARIOS, cashModel, bridge, dealMix, BETS, BUDGET, RULES, STAGES, EVENT_TYPES, CAMPAIGN_HEURISTICS, RULE_VERSION, PLAN_VERSION, addDaysStr } = E;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inr = v => v == null ? '—' : '₹' + Math.round(v).toLocaleString('en-IN');
const lakh = v => v == null ? '—' : '₹' + (Math.round(v / 1e3) / 100).toLocaleString('en-IN') + 'L';
const L = v => v == null ? '—' : '₹' + (Math.round(v * 100) / 100).toLocaleString('en-IN') + 'L';
const pc = v => v == null ? '—' : v + '%';
const uid = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const badge = (t, dk) => `<span class="badge${dk ? ' dk' : ''}">${t}</span>`;

// ---------- state ----------
let ORIGINAL, BASE, DSV, A, EX, config = { ai: false };
let mode = localStorage.getItem('gc_mode') || 'historical';
let histDate, execDate = localStorage.getItem('gc_exec_date') || '2027-01-28', compareDate = null;
let records = [], saveState = 'loading', chat = [], lastScope = null, staged = null;
let ws = JSON.parse(localStorage.getItem('gc_ws') || 'null');
if (!ws) { ws = { id: crypto.randomUUID(), token: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '') }; localStorage.setItem('gc_ws', JSON.stringify(ws)); }

// ---------- storage: per-browser Supabase workspace via /api/store, honest status, local fallback ----------
const H = () => ({ 'Content-Type': 'application/json', 'x-workspace-id': ws.id, 'x-workspace-token': ws.token });
const store = {
  remote: false,
  async load() {
    try { const r = await fetch('/api/store', { headers: H() }); const j = await r.json();
      if (r.ok && j.configured) { this.remote = true; saveState = 'saved'; return j.rows.map(x => ({ id: x.id, kind: x.kind, data: x.data, revision: x.revision })); } } catch {}
    this.remote = false; saveState = 'local';
    try { return JSON.parse(localStorage.getItem('gc_records') || '[]'); } catch { return []; }
  },
  async putMany(recs) {
    for (const rec of recs) { const i = records.findIndex(r => r.id === rec.id); if (i >= 0) records[i] = { ...rec, revision: (records[i].revision || 1) + 1 }; else records.push({ ...rec, revision: 1 }); }
    this.local();
    if (!this.remote) { saveState = 'local'; strip(); return true; }
    saveState = 'saving'; strip();
    try {
      for (let i = 0; i < recs.length; i += 150) {
        const r = await fetch('/api/store', { method: 'POST', headers: H(), body: JSON.stringify(recs.slice(i, i + 150)) });
        if (!r.ok) throw new Error((await r.json()).error || r.status);
      }
      saveState = 'saved'; strip(); return true;
    } catch (e) { saveState = 'failed'; strip(); flash('Cloud save failed (' + e.message + '). The change is kept in this browser only.'); return false; }
  },
  put(rec) { return this.putMany([rec]); },
  async del(ids) {
    ids = [].concat(ids); records = records.filter(r => !ids.includes(r.id)); this.local();
    if (this.remote) { saveState = 'saving'; strip(); try { for (const id of ids) { const r = await fetch('/api/store?id=' + encodeURIComponent(id), { method: 'DELETE', headers: H() }); if (!r.ok) throw new Error(r.status); } saveState = 'saved'; } catch { saveState = 'failed'; } strip(); }
  },
  async reset() { records = []; this.local(); if (this.remote) await fetch('/api/store', { method: 'POST', headers: H(), body: JSON.stringify({ action: 'reset' }) }); },
  local() { try { localStorage.setItem('gc_records', JSON.stringify(records)); } catch {} },
};
const of = k => records.filter(r => r.kind === k);
const tasks = () => of('task').map(r => ({ id: r.id, ...r.data }));
const settings = () => Object.assign({ fest_date: '2027-02-26', stall_capacity: 60 }, ...of('setting').map(r => r.data));
const campMeta = () => Object.fromEntries(of('campaign_meta').map(r => [r.data.campaign, r.data]));
const overlayRev = () => records.reduce((s, r) => s + (r.revision || 1), 0);
const asOf = () => mode === 'execution' ? execDate : histDate;
function stamp() { const n = records.filter(r => String(r.data?.at || '').startsWith(histDate)).length; return `${histDate}T23:${String(10 + Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; }
const curSnapshotId = () => snapshotId({ workspace: ws.id.slice(0, 8), dataset: DSV, overlayRevision: overlayRev(), asOf: asOf(), mode });

// ---------- dataset ----------
async function loadDataset() {
  const man = await (await fetch('/data/manifest.json')).json();
  const parts = await Promise.all(man.parts.map(async p => new Uint8Array(await (await fetch('/data/' + p.file)).arrayBuffer())));
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; parts.forEach(p => { all.set(p, o); o += p.length; });
  const j = JSON.parse(await new Response(new Blob([all]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  const sheets = {}; for (const [name, t] of Object.entries(j.columnar)) sheets[name] = t.rows.map(r => Object.fromEntries(t.cols.map((c, i) => [c, r[i]])));
  return sheets;
}

async function boot() {
  try { config = await (await fetch('/api/config')).json(); } catch {}
  ORIGINAL = await loadDataset(); BASE = ORIGINAL; DSV = datasetVersion(BASE);
  histDate = defaultDate(BASE);
  records = await store.load();
  wire(); setMode(mode);
}

let flashT; function flash(m) { const b = $('#banner'); b.innerHTML = esc(m); b.classList.add('on'); clearTimeout(flashT); flashT = setTimeout(banner, 6000); }
function banner() {
  const p = [];
  if (BASE !== ORIGINAL) p.push('Viewing an adopted uploaded workbook: every view and the copilot use it. Reset in Manage → Data.');
  if (!config.ai) p.push('AI copilot not configured (GEMINI_API_KEY missing on the server); the dashboard works without it.');
  $('#banner').innerHTML = esc(p.join(' ')); $('#banner').classList.toggle('on', p.length > 0);
}
function strip() {
  const st = { saved: ['st-ok', 'Saved to cloud workspace'], saving: ['', 'Saving…'], local: ['st-warn', 'Local only: cloud storage unreachable, saved in this browser'], failed: ['st-warn', 'Save failed: kept in this browser only'], loading: ['', 'Loading…'] }[saveState];
  const s = settings(); const T = Math.round((Date.parse(s.fest_date) - Date.parse(execDate)) / 864e5);
  const ev = (BASE.Event || [])[0] || {};
  $('#strip').innerHTML = [
    `Workspace <b>${ws.id.slice(0, 8)}</b> (this browser)`, `Mode <b>${{ historical: 'Historical 2025 (D)', plan: 'Deck plan (A/I)', execution: 'Execution demo (SIM/U)' }[mode]}</b>`,
    `As of <b>${asOf()}</b> end of day IST`,
    mode === 'execution' ? `Event <b>fest ${s.fest_date}</b> · <b>T-${T}</b>` : `Event <b>${esc(ev.event_name || 'CampusFest 2025')}</b>`,
    `Source <b>${BASE === ORIGINAL ? 'original workbook' : 'adopted upload'}</b> ${DSV}`, `Rules ${RULE_VERSION}`,
    `<span class="${st[0]}">${st[1]}</span>`].join(' · ');
}

function wire() {
  $$('.tabs button').forEach(b => b.onclick = () => { $$('.tabs button').forEach(x => x.classList.toggle('on', x === b)); $$('.tab').forEach(t => t.classList.toggle('on', t.id === b.dataset.tab)); });
  $$('.modes button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  $('#asof').onchange = e => { if (!e.target.value) return; if (mode === 'execution') { execDate = e.target.value; localStorage.setItem('gc_exec_date', execDate); } else histDate = e.target.value; compareDate = null; render(); };
  $('#copilotBtn').onclick = () => { const c = $('#copilot'); c.classList.toggle('off'); c.classList.toggle('open'); };
  $('#closeCp').onclick = () => { $('#copilot').classList.add('off'); $('#copilot').classList.remove('open'); };
  $('#drawerBtn').onclick = () => { renderDrawer(); $('#drawer').hidden = false; };
  $('#closeDrawer').onclick = () => { $('#drawer').hidden = true; };
  $('#drawer').onclick = e => { if (e.target.id === 'drawer') $('#drawer').hidden = true; };
  $('#ask').onsubmit = e => { e.preventDefault(); const q = $('#q').value.trim(); if (q) { $('#q').value = ''; ask(q); } };
  $('#clearChat').onclick = () => { chat = []; lastScope = null; renderChat(); };
}
function setMode(m) {
  mode = m; localStorage.setItem('gc_mode', m);
  $$('.modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  render();
}

function compute() {
  const S = applyEdits(BASE, records);
  A = analyse(S, histDate, { meta: { campaigns: campMeta() }, compareDate: compareDate || addDaysStr(histDate, -7), datasetVersion: DSV });
  EX = execAnalyse(records, settings(), execDate);
}
function render() {
  compute(); $('#asof').value = asOf();
  strip(); banner(); renderMeasure(); renderDiagnose(); renderDecide(); renderManage(); renderExamples(); renderChat();
}

// ---------- 1 · Measure ----------
const kpi = (v, l, cls = '', sub = '') => `<div class="kpi ${cls}"><div class="v">${v}</div><div class="l">${l}</div>${sub}</div>`;
function renderMeasure() {
  const k = A.kpis; let h = '';
  if (mode === 'historical') {
    h += `<div class="kpis">
      ${kpi(`${k.current_confirmed}/${k.target_confirmed ?? '—'}`, `Currently confirmed vs target in force (${esc(k.target_version || 'none')}) ${badge('D')}`, 'dark', `<div class="meter"><i style="width:${Math.min(100, k.confirmed_vs_target_pct || 0)}%"></i></div>`)}
      ${kpi(k.ever_confirmed, `Ever confirmed (incl. ${k.withdrawn} withdrawn after confirming)`)}
      ${kpi(lakh(k.signed_value_inr), `Signed value: ${lakh(k.signed_cash_support_inr)} cash-support + ${lakh(k.signed_in_kind_inr)} in-kind`)}
      ${kpi('Unavailable', 'Cash received: the workbook has no receipts. Signed ≠ banked.')}
      ${kpi(`${k.open_proposals} · ${lakh(k.open_proposal_value_inr)}`, `Open proposals; ${k.open_stage_age_14plus} ≥14 days in stage`)}
      ${kpi(pc(k.cold_outbound_activity_share_pct), `Recorded activity share on cold outbound (${k.cold_outbound_events}/${k.recorded_events} events), ${k.cold_outbound_current_wins} current wins`)}
    </div>`;
    h += `<div class="grid2"><div class="card"><h3>Brand funnel ${badge('D')}</h3><p class="muted">Each step counts brands that were also in the previous step (cohort).</p>${funnel(A.brandFunnel, 'cohort_conversion_pct')}</div>
      <div class="card"><h3>Opportunity funnel ${badge('D')}</h3><p class="muted">Unit is opportunities: 46 proposal opportunities come from 45 brands.</p>${funnel(A.oppFunnel, 'conversion_from_previous_pct')}
      <p class="muted small">Stages now: ${STAGES.map(s => `${s.replace('_', ' ')} ${k.stage_counts[s]}`).join(' · ')}</p></div></div>`;
    h += `<div class="card"><h3>Weekly trend ${badge('D')}</h3><p class="muted">First confirmations per Monday-start IST week and the confirmed-partnership target in force (stepwise: 20 → 28 from 15 Mar 2025).</p>${trendSvg(A.weekly)}</div>`;
    h += whatChanged();
  } else if (mode === 'plan') {
    h += planView();
  } else {
    const x = EX.kpis;
    h += execNote();
    h += `<div class="kpis">
      ${kpi(x.combined_receipts_cleared_inr == null ? 'None recorded' : lakh(x.combined_receipts_cleared_inr), `Cleared receipts before fest (sponsor ${lakh(x.sponsor_receipts_cleared_inr)} + stalls ${lakh(x.stall_receipts_cleared_inr)}) ${badge('SIM/U')}`, 'dark')}
      ${kpi(pc(x.combined_vs_base_pct) + ' / ' + pc(x.combined_vs_aim_pct), 'Of deck base ₹44.51L / aim ₹72.71L combined cash')}
      ${kpi(lakh(x.due_before_fest_remaining_inr), 'Scheduled, due before fest, not yet received')}
      ${kpi(lakh(x.overdue_inr), 'Overdue installments')}
      ${kpi(lakh(x.due_after_fest_inr), 'Due after the fest (cannot fund pre-fest costs)')}
      ${kpi(lakh(x.unscheduled_signed_cash_inr), 'Signed cash-support with no installment schedule')}
      ${kpi(lakh(x.other_funding_needed_inr), `Other funding still needed vs ₹1 Cr pre-fest obligation ${badge('I')}`)}
      ${kpi(`${x.stalls_fully_paid}/${x.stall_capacity}`, 'Stalls fully paid')}
    </div>`;
    h += `<div class="card"><h3>Cash calendar ${badge('SIM/U')}</h3><p class="muted">Installments by contract. Received = cleared receipts linked to the installment before the fest. Not a bank balance.</p>${table(EX.installments, [['id', 'Installment'], ['sponsor', 'Sponsor'], ['due_date', 'Due'], ['amount_inr', 'Amount', inr], ['paid_inr', 'Cleared', inr], ['remaining_inr', 'Remaining', inr], ['bucket', 'Bucket']])}</div>`;
  }
  $('#measure').innerHTML = h;
  const cd = $('#cmpDate'); if (cd) cd.onchange = e => { compareDate = e.target.value; render(); };
}
function execNote() { return EX.receipts.length || EX.offers.length ? `<div class="warn">Execution mode uses operational records: ${records.some(r => r.data?.sim) ? '<b>SIMULATED demo records are loaded</b> (labelled SIM). ' : ''}Your own entries are labelled U. Historical 2025 has no receipts; nothing here is dataset fact.</div>` : `<div class="warn">No execution records yet. Load the simulated demo in Manage → Execution records, or enter real offers, installments and receipts.</div>`; }
function funnel(rows, key) {
  const max = rows[0].value || 1;
  return `<div class="fun">${rows.map((r, i) => `${i && r[key] != null ? `<div class="cv">${r[key]}% of previous step${r.also_in_previous_step != null && r.also_in_previous_step !== r.value ? ` (${r.also_in_previous_step} of ${r.value} were in it)` : ''}</div>` : ''}<div class="row"><span>${esc(r.stage)}</span><div class="bar"><i style="width:${100 * r.value / max}%"></i></div><span class="num">${r.value}</span></div>`).join('')}</div>`;
}
function trendSvg(w) {
  const W = 900, Hh = 190, p = 30, n = w.length, max = Math.max(4, ...w.map(x => x.target_confirmed_in_force || 0), ...w.map(x => x.cumulative_ever_confirmed));
  const X = i => p + i * (W - 2 * p) / Math.max(1, n - 1), Y = v => Hh - p - v * (Hh - 2 * p) / max;
  const line = (f, attrs) => `<polyline fill="none" ${attrs} points="${w.map((x, i) => `${X(i)},${Y(f(x) || 0)}`).join(' ')}"/>`;
  return `<svg viewBox="0 0 ${W} ${Hh}" width="100%" role="img" aria-label="weekly trend">
    ${w.map((x, i) => `<rect x="${X(i) - 8}" y="${Y(x.first_confirmations)}" width="16" height="${Hh - p - Y(x.first_confirmations)}" fill="#7FB2FF"><title>${x.week_start}: ${x.first_confirmations} first confirmations, ${x.held_meetings} meetings</title></rect>`).join('')}
    ${line(x => x.cumulative_ever_confirmed, 'stroke="#1F5FD6" stroke-width="2.5"')}
    ${line(x => x.target_confirmed_in_force, 'stroke="#0B2A5E" stroke-width="2" stroke-dasharray="6 4"')}
    ${w.map((x, i) => i % 2 ? '' : `<text x="${X(i)}" y="${Hh - 10}" font-size="10" text-anchor="middle" fill="#4A5568">${x.week_start.slice(5)}</text>`).join('')}
    <text x="${W - p}" y="16" font-size="11" text-anchor="end" fill="#0B2A5E">— cumulative ever confirmed · - - target in force · bars: first confirmations that week</text></svg>`;
}
function whatChanged() {
  const c = A.changes;
  return `<div class="card"><h3>What changed ${badge('D')}</h3><p class="muted">Entity-level comparison between two end-of-day snapshots. From <input type="date" id="cmpDate" value="${c.from}"> to ${c.to}.</p>
    ${c.items.length ? table(c.items, [['type', 'Change'], ['id', 'ID'], ['brand', 'Brand'], ['detail', 'Detail'], ['signed_delta_inr', 'Signed Δ', inr]]) : '<p class="muted">No entity changes in this window.</p>'}
    <p class="muted small">Reconciliation: signed value change ${inr(c.reconciliation.signed_value_change_inr)}, explained by listed items ${inr(c.reconciliation.explained_by_items_inr)}.</p>
    <details><summary>Metric deltas</summary>${table(c.metrics, [['metric', 'Metric'], ['from', 'From'], ['to', 'To'], ['change', 'Δ']])}</details></div>`;
}
function planView() {
  const rows = Object.entries(SCENARIOS).map(([k, p]) => ({ scenario: p.label, ...cashModel(p) }));
  const b = bridge(); const max = Math.max(...b.steps.map(s => s.value_l)) * 1.05; let run = 0;
  const bars = b.steps.map((s, i) => { const total = i === 0 || i === b.steps.length - 1; const base = total ? 0 : run; if (i === 0) run = s.value_l; else if (!total) run += s.value_l;
    return { s, total, base, h: s.value_l }; });
  const dm = dealMix(A.kpis.average_signed_deal_inr || 93333);
  return `<div class="warn">Deck plan mode shows the frozen deck model (${PLAN_VERSION}). These are planning scenarios from interviews and assumptions (A/I), not dataset facts and not forecasts.</div>
    <div class="card"><h3>Scenarios ${badge('A/I')}</h3><p class="muted">Sponsor cash = (Top × share + Mid × share + Local × share) × 0.98 (TDS assumption) + stall cash. Exact values kept; display rounds.</p>
    ${table(rows, [['scenario', 'Scenario'], ['signed_l', 'Signed', L], ['sponsor_cash_l', 'Sponsor cash pre-fest', L], ['stalls_l', 'Stalls', L], ['combined_cash_l', 'Combined', L], ['other_funding_needed_l', 'Other funding needed vs ₹1 Cr', L], ['formula', 'Formula']])}
    <p class="muted small">Aim signed total is exactly ₹102.25L (shown on the deck as ~₹1 Cr). Without the title advance the aim falls to ₹63.89L (−₹8.82L).</p></div>
    <div class="grid2"><div class="card"><h3>${esc(b.label)} ${badge('A')}</h3>
      <div class="wf">${bars.map(x => `<div><span>${L(x.h)}</span><i class="gap" style="height:${100 * x.base / max}%;order:2"></i><i class="${x.total ? 'tot' : ''}" style="height:${100 * x.h / max}%"></i></div>`).join('')}</div>
      <div class="wf-l">${b.steps.map(s => `<span>${esc(s.step)}</span>`).join('')}</div><p class="muted small">${esc(b.note)}</p></div>
    <div class="card"><h3>Deal mix ${badge('A')} vs history ${badge('D')}</h3><p class="muted">Historical average signed deal ${L(dm.historical_avg_l)}. Base mix ${dm.base.deals} deals avg ${L(dm.base.avg_l)} (${dm.base.multiple_of_historical.toFixed(2)}×); aim ${dm.aim.deals} deals avg ${L(dm.aim.avg_l)} (${dm.aim.multiple_of_historical.toFixed(2)}×). ${esc(dm.message)}</p>
      ${table(E.TIER_MIX.aim.map(([t, n, v], i) => ({ tier: t, base_deals: E.TIER_MIX.base[i][1], base_value: E.TIER_MIX.base[i][2], aim_deals: n, aim_value: v })), [['tier', 'Tier'], ['base_deals', 'Base deals'], ['base_value', 'Base ₹L'], ['aim_deals', 'Aim deals'], ['aim_value', 'Aim ₹L']])}
      <p class="muted small">Budget: ${BETS.map(x => `${x.id} ₹${x.budget_l}L`).join(' · ')} = ₹${BUDGET.allocated_l}L allocated, ₹${BUDGET.unallocated_l}L unallocated of ₹${BUDGET.envelope_l}L.</p></div></div>
    ${scenarioLab()}`;
}
function scenarioLab() {
  const saved = of('scenario');
  return `<div class="card"><h3>Scenario lab ${badge('A')}</h3><p class="muted">Change inputs to see combined pre-fest cash. Saved scenarios are named and never overwrite the frozen deck base/aim.</p>
    <form id="labForm" class="row">${['top', 'topShare', 'mid', 'midShare', 'local', 'localShare', 'stalls'].map(f => `<label class="muted small">${f}<br><input name="${f}" type="number" step="0.01" value="${SCENARIOS.base[f]}"></label>`).join('')}
    <input name="name" placeholder="Scenario name" required><button>Save scenario</button></form><div id="labOut" class="muted"></div>
    ${saved.length ? table(saved.map(r => ({ name: r.data.name, ...cashModel(r.data) })), [['name', 'Saved scenario'], ['signed_l', 'Signed', L], ['combined_cash_l', 'Combined', L], ['formula', 'Formula']]) : ''}</div>`;
}

// ---------- 2 · Diagnose ----------
function renderDiagnose() {
  const k = A.kpis;
  $('#diagnose').innerHTML = `
    <div class="card"><h3>Campaign scorecard ${badge('D')}</h3><p class="muted">${esc(CAMPAIGN_HEURISTICS.note)} Routes: warm introduction, inbound (SC04 is inbound, not warm), renewal, cold outbound. Spend is unknown until entered; cost per win is undefined with 0 wins.</p>
    ${table(A.byCampaign, [['campaign_id', 'ID'], ['campaign', 'Campaign'], ['route', 'Route'], ['owner', 'Owner'], ['recorded_events', 'Events'], ['activity_share_pct', 'Activity %'], ['reply_rate', 'Replied/touched'], ['meeting_rate', 'Met/touched'], ['win_per_opportunity', 'Won/opps'], ['open_proposals', 'Open'], ['signed_cash_support_inr', 'Signed cash-support', inr], ['spent_inr', 'Spent (U)', inr], ['cost_per_current_win_inr', 'Cost/win', v => typeof v === 'number' ? inr(v) : esc(v ?? 'unknown')], ['heuristic_call', 'Heuristic', v => `<span class="pill ${v}">${v}</span>`], ['heuristic_reason', 'Why']])}</div>
    <div class="grid2">
      <div class="card"><h3>Open proposals ageing ${badge('D')}</h3><p class="muted">${k.open_proposals} open worth ${lakh(k.open_proposal_value_inr)}. Days in current stage counts from the start of the latest consecutive run of that stage.</p>
      ${table(A.open.slice().sort((a, b) => b.days_in_current_stage - a.days_in_current_stage), [['opportunity_id', 'ID'], ['brand', 'Brand'], ['campaign', 'Campaign'], ['stage', 'Stage'], ['proposed_inr', 'Proposed', inr], ['days_in_current_stage', 'Days in stage'], ['days_since_meaningful_activity', 'Days since activity'], ['owner', 'Owner']])}</div>
      <div class="card"><h3>Naive pooled closure scenario ${badge('A')}</h3><p class="muted">${esc(A.naive.label)}</p>
      ${kpi(pc(A.naive.pooled_rate_pct), `Pooled closure among resolved proposals (${A.naive.resolved_sample})`)}
      <p>If every open deal closed at that rate: ${A.naive.expected_partnerships} partnerships, ${inr(A.naive.expected_reported_value_inr)} reported value.</p><p class="muted small">${esc(A.naive.caveat)}</p>
      <h3>Withdrawn after confirming</h3>${table(k.withdrawn_after_confirming, [['id', 'ID'], ['brand', 'Brand'], ['confirmed_on', 'Confirmed'], ['withdrawn_on', 'Withdrawn'], ['value_inr', 'Value', inr]])}</div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Industries ${badge('D')}</h3>${table(A.byIndustry, [['industry', 'Industry'], ['brands', 'Brands'], ['opportunities', 'Opps'], ['current_wins', 'Wins'], ['signed_inr', 'Signed', inr], ['lost', 'Lost'], ['open_proposal_value_inr', 'Open value', inr]])}</div>
      <div class="card"><h3>Owners ${badge('D')}</h3>${table(A.owners, [['owner', 'Owner'], ['opportunities', 'Opps'], ['win_per_opportunity', 'Won/opps'], ['signed_inr', 'Signed', inr], ['open_proposals', 'Open'], ['open_proposal_value_inr', 'Open value', inr]])}</div>
    </div>
    <div class="card"><h3>All opportunities at ${histDate} ${badge('D')}</h3><div class="filters"><input id="oppFilter" placeholder="Filter by brand, campaign, stage, owner…"></div><div id="oppTable">${oppTable('')}</div></div>
    <div class="card"><h3>Data quality ${badge('D')}</h3>${table(A.quality, [['check', 'Check'], ['value', 'Value']])}${A.conflicts.length ? table(A.conflicts, [['sheet', 'Sheet'], ['id', 'ID'], ['note', 'Note']]) : ''}</div>`;
  $('#oppFilter').oninput = e => { $('#oppTable').innerHTML = oppTable(e.target.value); };
}
function oppTable(q) {
  q = q.toLowerCase(); const rows = A.oppRows.filter(o => !q || JSON.stringify(o).toLowerCase().includes(q));
  return table(rows, [['opportunity_id', 'ID'], ['brand', 'Brand'], ['industry', 'Industry'], ['campaign', 'Campaign'], ['route', 'Route'], ['support_type', 'Support'], ['stage', 'Stage', v => `<span class="pill ${v}">${v}</span>`], ['proposed_inr', 'Proposed', inr], ['confirmed_inr', 'Confirmed', inr], ['days_in_current_stage', 'Days in stage'], ['owner', 'Owner'], ['edited_in_app', 'U', v => v ? badge('U') : '']]);
}

// ---------- 3 · Decide ----------
function renderDecide() {
  const decisions = of('decision').map(r => ({ id: r.id, ...r.data }));
  const evals = mode === 'execution' ? EX.rules : null;
  const card = (r, ev) => {
    const state = ev ? ev.state : mode === 'execution' ? 'insufficient data' : 'not applicable';
    const cls = /review/.test(state) ? 'review' : /insufficient|applicable/.test(state) ? 'insufficient' : /not due/.test(state) ? 'notdue' : '';
    const call = ev && ev.call;
    return `<div class="rule"><div class="rh"><span>${r.bet}${ev?.gate ? ' · ' + ev.gate + ' gate' : ''}</span><span class="state ${cls}">${call ? call.toUpperCase() : esc(state)}</span></div><div class="rb">
      <b>${esc(ev?.metric || r.metric)}</b>
      <div class="big">${ev && ev.value != null ? esc(ev.value) + ' <small>' + esc(ev.unit || '') + '</small>' : '—'}</div>
      <div class="muted small">${esc(ev ? ev.window : mode === 'execution' ? 'no records' : 'Historical 2025 has no execution records: switch to Execution demo')}</div>
      <div class="thr">${['stop', 'change', 'plan', 'scale'].map(k => `<span class="${call === k ? 'on' : ''}">${k}<br>${esc(r.published[k])}</span>`).join('')}</div>
      ${call ? `<div><b>Action:</b> ${esc(ev.action)}</div>` : ''}${ev?.progress ? `<div class="muted small">${esc(ev.progress)}</div>` : ''}
      <details><summary class="small">Interpretation (A) and evidence</summary><p class="small">${esc(r.interpretation)}</p><p class="small">Risk: ${esc(r.risk)}</p>${ev?.evidence?.length ? `<p class="small">Evidence IDs: ${esc(ev.evidence.slice(0, 20).join(', '))}</p>` : ''}${ev?.basis ? `<p class="small">${esc(ev.basis)}</p>` : ''}</details>
      ${ev ? `<div class="acts"><button class="sm" data-dec="${r.bet}${ev.gate ? ':' + ev.gate : ''}" data-call="${call || state}">Record decision</button></div>` : ''}</div></div>`;
  };
  const cards = mode === 'execution' ? evals.map(ev => card(RULES.find(r => r.bet === ev.bet), ev)) : RULES.map(r => card(r, null));
  $('#decide').innerHTML = `
    <div class="card"><h3>Trigger cards: deck slide 3 thresholds ${badge('A')}</h3><p class="muted">Published thresholds are shown verbatim; the documented interpretation fills gaps. States: evaluated, review (no published branch), insufficient data, not due. Calls are recommendations; a human records the decision. ${mode === 'execution' ? `Fest ${settings().fest_date}, T-${EX.kpis.t_minus_days}.` : ''}</p>
    <div class="rules">${cards.join('')}</div></div>
    <div class="card"><h3>Five bets: operating cards ${badge('A/I')}</h3>${table(BETS, [['rank', '#'], ['name', 'Bet'], ['fixes', 'Fixes'], ['budget_l', 'Budget ₹L'], ['team', 'Team'], ['by', 'By'], ['stake', 'Stake'], ['call', 'Deck call']])}
      <p class="muted small">₹${BUDGET.allocated_l}L allocated + ₹${BUDGET.unallocated_l}L unallocated = ₹${BUDGET.envelope_l}L. ${esc(BUDGET.note)}</p></div>
    <div class="card"><h3>Decision ledger ${badge('U')}</h3><p class="muted">Each decision records the rule call, what the team chose (accept or override) and why, with the snapshot it was made on.</p>
      <div id="decForm"></div>${decisions.length ? table(decisions, [['week', 'Date'], ['bet', 'Bet'], ['rule_call', 'Rule said'], ['choice', 'Decision'], ['rationale', 'Why'], ['owner', 'Owner'], ['snapshot_id', 'Snapshot']]) : '<p class="muted">No decisions recorded yet.</p>'}</div>`;
  $$('[data-dec]').forEach(b => b.onclick = () => decisionForm(b.dataset.dec, b.dataset.call));
}
function decisionForm(bet, call) {
  $('#decForm').innerHTML = `<form class="row preview" id="dform"><b>${esc(bet)}</b> rule says <b>${esc(call)}</b>
    <select name="choice"><option value="accept">Accept the call</option><option value="override">Override</option><option value="hold">Hold for review</option></select>
    <input name="rationale" placeholder="Why (required for override)"><input name="owner" placeholder="Owner"><button>Save decision</button></form>`;
  $('#decForm').scrollIntoView({ block: 'center' });
  $('#dform').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    if (f.choice === 'override' && !f.rationale.trim()) return flash('An override needs a reason.');
    await store.put({ id: uid('dec'), kind: 'decision', data: { bet, rule_call: call, ...f, week: asOf(), snapshot_id: curSnapshotId(), rule_version: RULE_VERSION } }); render(); };
}

// ---------- 4 · Manage ----------
function suggested() {
  const out = [];
  A.open.filter(o => o.days_in_current_stage >= 14).forEach(o => out.push({ title: `Re-engage ${o.brand} (${o.stage.replace('_', ' ')}, ${o.days_in_current_stage}d in stage)`, owner: o.owner, linked: o.opportunity_id, reason: `${inr(o.proposed_inr)} open; no stage change for ${o.days_in_current_stage} days`, due: addDaysStr(asOf(), 3) }));
  if (mode === 'execution') {
    EX.rules.filter(r => r.call && r.call !== 'plan').forEach(r => out.push({ title: `${r.bet}${r.gate ? ' ' + r.gate : ''}: ${r.action}`, owner: '', linked: r.bet, reason: `Rule call ${r.call} (${r.value} ${r.unit}, ${r.window})`, due: addDaysStr(asOf(), 2) }));
    EX.installments.filter(i => i.bucket === 'overdue').forEach(i => out.push({ title: `Chase overdue installment ${i.id} (${i.sponsor})`, owner: '', linked: i.id, reason: `${inr(i.remaining_inr)} overdue since ${i.due_date}`, due: addDaysStr(asOf(), 1) }));
  }
  const have = new Set(tasks().map(t => t.idem));
  return out.map(t => ({ ...t, idem: 'sug-' + E.hash(t.linked + '|' + t.title) })).filter(t => !have.has(t.idem));
}
function renderManage() {
  const T = tasks(); const col = s => T.filter(t => (t.status || 'todo') === s);
  const sug = suggested();
  const camps = A.byCampaign;
  $('#manage').innerHTML = `
    <div class="card"><h3>Task board ${badge('U')}</h3>
      <form id="taskForm" class="row"><input name="title" placeholder="Task" required size="34"><input name="owner" placeholder="Owner"><input name="linked" placeholder="Linked deal / campaign / bet"><input name="due" type="date" value="${addDaysStr(asOf(), 3)}"><button>Add task</button></form>
      <div class="board">${['todo', 'doing', 'done'].map(s => `<div class="col"><h4>${{ todo: 'To do', doing: 'In progress', done: 'Done' }[s]} (${col(s).length})</h4>${col(s).map(t => `<div class="task ${t.status !== 'done' && t.due && t.due < asOf() ? 'late' : ''}"><b>${esc(t.title)}</b>
        <div class="meta">${esc(t.owner || 'unassigned')} · due ${esc(t.due || '—')}${t.linked ? ' · ' + esc(t.linked) : ''}${t.source ? ' · ' + esc(t.source) : ''}${t.status !== 'done' && t.due && t.due < asOf() ? ' · <span class="late-tag">overdue</span>' : ''}</div>
        <div class="acts">${['todo', 'doing', 'done'].filter(x => x !== s).map(x => `<button class="sm no" data-mv="${t.id}" data-to="${x}">${x}</button>`).join('')}<button class="sm no" data-del="${t.id}">delete</button></div></div>`).join('')}</div>`).join('')}</div></div>
    <div class="grid2">
      <div class="card"><h3>Suggested tasks</h3><p class="muted">From ageing proposals${mode === 'execution' ? ', rule calls and overdue installments' : ''}. Confirm to add; each suggestion can be added once.</p>
        ${sug.slice(0, 12).map((t, i) => `<div class="sugg"><b>${esc(t.title)}</b><div class="meta">${esc(t.owner || 'unassigned')} · ${esc(t.reason)}</div><button class="sm" data-sug="${i}">Add task</button></div>`).join('') || '<p class="muted">Nothing to suggest.</p>'}</div>
      <div class="card"><h3>Monday decision brief</h3><p class="muted">Exports the current snapshot, rule states, decisions and open tasks as Markdown.</p><button id="brief">Download brief (.md)</button>
        <h3 style="margin-top:14px">Workspace</h3><p class="muted small">ID ${ws.id} · ${records.length} records · ${store.remote ? 'cloud (Supabase) + browser copy' : 'this browser only'}.</p>
        <button class="no" id="wsReset">Reset this workspace</button></div>
    </div>
    <div class="card"><h3>Campaigns ${badge('U')}</h3><p class="muted">Budget, spend, owner and status are app entries (U). New campaigns are added as dated records.</p>
      ${table(camps, [['campaign', 'Campaign'], ['route', 'Route'], ['owner', 'Owner'], ['status', 'Status'], ['budget_inr', 'Budget', inr], ['spent_inr', 'Spent', inr], ['campaign', 'Edit', v => `<button class="sm no" data-camp="${esc(v)}">edit</button>`]])}
      <div id="campEdit"></div>
      <form id="campNew" class="row"><b>New campaign</b><input name="campaign_name" placeholder="Name" required><select name="channel">${Object.keys(E.ROUTE_OF_CHANNEL).map(c => `<option>${c}</option>`).join('')}</select><input name="owner_name" placeholder="Owner"><input name="objective" placeholder="Objective"><button>Create</button></form></div>
    <div class="grid2">
      <div class="card"><h3>Update a deal ${badge('U')}</h3><p class="muted">Adds a new dated stage record at the as-of date (${histDate}); history is kept.</p>
        <form id="oppUpd" class="row"><select name="opportunity_id">${A.oppRows.map(o => `<option value="${o.opportunity_id}">${o.opportunity_id} · ${esc(o.brand)} · ${o.stage}</option>`).join('')}</select>
        <select name="stage">${STAGES.map(s => `<option>${s}</option>`).join('')}</select><input name="proposed_value_inr" type="number" placeholder="Proposed ₹"><input name="confirmed_value_inr" type="number" placeholder="Confirmed ₹"><input name="note" placeholder="Note"><button>Save update</button></form>
        <h3>New opportunity</h3><form id="oppNew" class="row"><input name="brand_name" placeholder="Brand" required><select name="campaign_name">${camps.map(c => `<option>${esc(c.campaign)}</option>`).join('')}</select><select name="support_type"><option>cash</option><option>in_kind</option></select><input name="proposed_value_inr" type="number" placeholder="Proposed ₹" required><input name="owner_name" placeholder="Owner"><button>Add</button></form></div>
      <div class="card"><h3>Log an interaction ${badge('U')}</h3><form id="intLog" class="row"><input name="brand_name" placeholder="Brand" required list="brandList"><datalist id="brandList">${[...new Set(A.oppRows.map(o => o.brand))].map(b => `<option>${esc(b)}</option>`).join('')}</datalist>
        <select name="campaign_name">${camps.map(c => `<option>${esc(c.campaign)}</option>`).join('')}</select><select name="event_type">${EVENT_TYPES.map(t => `<option>${t}</option>`).join('')}</select><input name="summary" placeholder="Summary"><button>Log</button></form></div>
    </div>
    <div class="card"><h3>Execution records ${badge('SIM/U')}</h3><p class="muted">Offers, installments, receipts, stalls, renewals and warm introductions drive the Execution mode trigger cards and cash calendar.</p>
      <div class="acts"><button id="demoLoad">Load simulated execution demo</button><button class="no" id="demoClear">Remove simulated records</button></div>
      <form id="setForm" class="row" style="margin-top:10px"><b>Settings</b><label class="small">Fest start <input name="fest_date" type="date" value="${settings().fest_date}"></label><label class="small">Stall capacity <input name="stall_capacity" type="number" value="${settings().stall_capacity}"></label><button class="sm">Save</button></form>
      <form id="rcpForm" class="row"><b>Receipt</b><select name="category"><option>sponsor</option><option>stall</option></select><input name="offer_id" placeholder="Offer ID" list="offerList"><datalist id="offerList">${EX.offers.map(o => `<option value="${o.id}">${esc(o.sponsor)}</option>`).join('')}</datalist><input name="installment_id" placeholder="Installment ID"><input name="stall_id" placeholder="Stall ID"><input name="amount_inr" type="number" placeholder="Net amount ₹" required><input name="cleared_date" type="date" value="${execDate}"><select name="status"><option>cleared</option><option>pending</option></select><button>Add receipt</button></form>
      <form id="offForm" class="row"><b>Offer</b><input name="sponsor" placeholder="Sponsor" required><select name="tier"><option>title</option><option>co_title</option><option>associate</option><option>big</option><option>event</option><option>local</option></select><input name="value_inr" type="number" placeholder="Value ₹" required><select name="support"><option>cash</option><option>in_kind</option></select><select name="status"><option>proposed</option><option>term_sheet</option><option>signed</option><option>withdrawn</option></select><input name="offer_date" type="date" value="${execDate}"><input name="signed_date" type="date"><label class="small"><input type="checkbox" name="discount_offered"> pay-early discount</label><input name="advance_share" type="number" step="0.05" placeholder="Advance share"><button>Add offer</button></form>
      <form id="insForm" class="row"><b>Installment</b><input name="offer_id" placeholder="Offer ID" list="offerList" required><input name="due_date" type="date" required><input name="amount_inr" type="number" placeholder="Amount ₹" required><button>Add installment</button></form>
      <details><summary>Records (${EX.offers.length} offers · ${EX.installments.length} installments · ${EX.receipts.length} receipts · ${EX.stalls.length} stalls · ${EX.renewals.length} renewals · ${EX.intros.length} intros)</summary>
        ${table(EX.offers, [['id', 'Offer'], ['sponsor', 'Sponsor'], ['tier', 'Tier'], ['value_inr', 'Value', inr], ['support', 'Support'], ['status', 'Status'], ['signed_date', 'Signed'], ['sim', '', v => v ? badge('SIM') : badge('U')]])}
        ${table(EX.receipts, [['id', 'Receipt'], ['category', 'Category'], ['offer_id', 'Offer'], ['stall_id', 'Stall'], ['amount_inr', 'Amount', inr], ['cleared_date', 'Cleared'], ['status', 'Status'], ['sim', '', v => v ? badge('SIM') : badge('U')]])}</details></div>
    <div class="card"><h3>Data: upload a changed workbook</h3><p class="muted">Staging → validation → preview → adopt. The current version stays live until you adopt.</p>
      <label class="file" style="display:inline-block">Choose .xlsx or .json<input type="file" id="upload" accept=".xlsx,.json"></label> <button class="no" id="resetData">Reset to original workbook</button>
      <div id="stage">${staged ? stagePreview() : ''}</div></div>`;
  wireManage();
}
function wireManage() {
  const fd = e => Object.fromEntries(new FormData(e.target));
  $('#taskForm').onsubmit = async e => { e.preventDefault(); await store.put({ id: uid('task'), kind: 'task', data: { status: 'todo', source: 'manual', ...fd(e) } }); render(); };
  $$('[data-mv]').forEach(b => b.onclick = async () => { const r = records.find(x => x.id === b.dataset.mv); await store.put({ ...r, data: { ...r.data, status: b.dataset.to } }); render(); });
  $$('[data-del]').forEach(b => b.onclick = async () => { await store.del(b.dataset.del); render(); });
  const sug = suggested();
  $$('[data-sug]').forEach(b => b.onclick = async () => { const t = sug[+b.dataset.sug]; await store.put({ id: t.idem, kind: 'task', data: { status: 'todo', source: 'suggested', ...t } }); render(); });
  $('#brief').onclick = () => {
    const md = decisionBrief({ a: A, exec: mode === 'execution' ? EX : null, tasks: tasks(), decisions: of('decision').map(r => r.data), snapshot_id: curSnapshotId(), mode });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' })); a.download = `monday-brief-${asOf()}.md`; a.click();
  };
  $('#wsReset').onclick = async () => { if (!confirm('Delete every record in this workspace (tasks, decisions, receipts, edits)? This cannot be undone.')) return; await store.reset(); render(); };
  $$('[data-camp]').forEach(b => b.onclick = () => { const c = A.byCampaign.find(x => x.campaign === b.dataset.camp);
    $('#campEdit').innerHTML = `<form id="cform" class="row preview"><b>${esc(c.campaign)}</b><input name="owner" value="${esc(c.owner || '')}" placeholder="Owner"><select name="status">${['active', 'paused', 'ended'].map(s => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}</select><input name="budget_inr" type="number" value="${c.budget_inr ?? ''}" placeholder="Budget ₹"><input name="spent_inr" type="number" value="${c.spent_inr ?? ''}" placeholder="Spent ₹"><button>Save</button></form>`;
    $('#cform').onsubmit = async e => { e.preventDefault(); const f = fd(e); const num = v => v === '' ? null : Number(v);
      await store.put({ id: 'cm-' + E.hash(c.campaign), kind: 'campaign_meta', data: { campaign: c.campaign, owner: f.owner, status: f.status, budget_inr: num(f.budget_inr), spent_inr: num(f.spent_inr) } }); render(); }; });
  $('#campNew').onsubmit = async e => { e.preventDefault(); await store.put({ id: uid('SCX'), kind: 'campaign', data: { ...fd(e), at: stamp() } }); render(); };
  $('#oppUpd').onsubmit = async e => { e.preventDefault(); const f = fd(e); const o = A.oppRows.find(x => x.opportunity_id === f.opportunity_id);
    await store.put({ id: uid('upd'), kind: 'opp_update', data: { ...f, brand_name: o.brand, brand_id: o.brand_id, owner_name: o.owner, proposed_value_inr: f.proposed_value_inr || o.proposed_inr, confirmed_value_inr: f.confirmed_value_inr || (f.stage === 'partner_confirmed' ? (f.proposed_value_inr || o.proposed_inr) : 0), at: stamp() } }); render(); };
  $('#oppNew').onsubmit = async e => { e.preventDefault(); await store.put({ id: uid('OX'), kind: 'opp_new', data: { ...fd(e), stage: 'prospecting', at: stamp() } }); render(); };
  $('#intLog').onsubmit = async e => { e.preventDefault(); await store.put({ id: uid('IX'), kind: 'interaction', data: { ...fd(e), at: stamp() } }); render(); };
  $('#demoLoad').onclick = async () => { const recs = demoExecutionRecords(settings().fest_date); await store.putMany(recs); setMode('execution'); flash(`Loaded ${recs.length} simulated execution records (labelled SIM).`); };
  $('#demoClear').onclick = async () => { await store.del(records.filter(r => r.data?.sim).map(r => r.id)); render(); };
  $('#setForm').onsubmit = async e => { e.preventDefault(); await store.put({ id: 'setting-main', kind: 'setting', data: { ...fd(e), stall_capacity: Number(fd(e).stall_capacity) } }); render(); };
  $('#rcpForm').onsubmit = async e => { e.preventDefault(); const f = fd(e); await store.put({ id: uid('rcp'), kind: 'receipt', data: { ...f, amount_inr: Number(f.amount_inr), net: true } }); render(); };
  $('#offForm').onsubmit = async e => { e.preventDefault(); const f = fd(e); await store.put({ id: uid('off'), kind: 'offer', data: { ...f, value_inr: Number(f.value_inr), discount_offered: !!f.discount_offered, advance_share: Number(f.advance_share || 0) } }); render(); };
  $('#insForm').onsubmit = async e => { e.preventDefault(); const f = fd(e); await store.put({ id: uid('ins'), kind: 'installment', data: { ...f, amount_inr: Number(f.amount_inr) } }); render(); };
  $('#upload').onchange = e => stageUpload(e.target.files[0]);
  $('#resetData').onclick = () => { BASE = ORIGINAL; DSV = datasetVersion(BASE); staged = null; histDate = defaultDate(BASE); render(); };
  const ad = $('#adopt'); if (ad) ad.onclick = () => { BASE = staged.sheets; DSV = datasetVersion(BASE); histDate = defaultDate(BASE); staged = null; render(); flash('Adopted the uploaded workbook. Your app records are kept and re-applied.'); };
  const dc = $('#discard'); if (dc) dc.onclick = () => { staged = null; render(); };
  const lab = $('#labForm'); if (lab) { const upd = () => { const f = Object.fromEntries(new FormData(lab)); const p = Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'name').map(([k, v]) => [k, Number(v)])); const m = cashModel(p); $('#labOut').textContent = `Combined pre-fest cash ${L(m.combined_cash_l)} (sponsor ${L(m.sponsor_cash_l)} + stalls ${L(m.stalls_l)}); other funding needed ${L(m.other_funding_needed_l)}.`; return p; };
    lab.oninput = upd; upd(); lab.onsubmit = async e => { e.preventDefault(); const p = upd(); await store.put({ id: uid('scn'), kind: 'scenario', data: { ...p, name: new FormData(lab).get('name') } }); render(); }; }
}
async function stageUpload(f) {
  if (!f) return;
  try {
    let S;
    if (f.name.endsWith('.json')) { const j = JSON.parse(await f.text()); S = j.sheets || j; }
    else {
      if (!window.XLSX) window.XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
      const wb = window.XLSX.read(await f.arrayBuffer(), { cellDates: true }); S = {};
      const iso = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
      wb.SheetNames.forEach(n => { S[n] = window.XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null, raw: true }).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? iso(v) : v]))); });
    }
    const v = validateSheets(S);
    let preview = null;
    if (v.ok) { const a = analyse(S, defaultDate(S)); preview = { as_of: defaultDate(S), current: A.kpis, next: a.kpis }; }
    staged = { name: f.name, sheets: S, validation: v, preview };
  } catch (err) { staged = { name: f.name, validation: { ok: false, errors: ['Could not read file: ' + err.message], warnings: [] } }; }
  render(); document.querySelector('[data-tab=manage]').click(); $('#stage').scrollIntoView({ block: 'center' });
}
function stagePreview() {
  const v = staged.validation;
  if (!v.ok) return `<div class="preview"><b>${esc(staged.name)}: rejected.</b> The live data is unchanged.<ul>${v.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul><button class="no" id="discard">Dismiss</button></div>`;
  const p = staged.preview; const keys = ['recorded_events', 'opportunities', 'current_confirmed', 'ever_confirmed', 'signed_value_inr', 'open_proposals', 'target_confirmed'];
  return `<div class="preview"><b>${esc(staged.name)}: valid.</b> ${v.warnings.map(esc).join(' ')}<br>Preview at its history end (${p.as_of}):
    ${table(keys.map(k => ({ metric: k, current: p.current[k], uploaded: p.next[k] })), [['metric', 'Metric'], ['current', 'Live'], ['uploaded', 'Uploaded']])}
    <button id="adopt">Adopt this workbook</button> <button class="no" id="discard">Discard</button></div>`;
}

// ---------- drawer ----------
function renderDrawer() {
  $('#drawerBody').innerHTML = `
    <h3>Snapshot</h3><p class="small">ID <code>${curSnapshotId()}</code> · dataset ${DSV} · overlay revision ${overlayRev()} · rules ${RULE_VERSION} · plan ${PLAN_VERSION}</p>
    <h3>Definitions</h3><ul class="qual small">
      <li><b>As of</b>: end of the selected day in IST; implemented as strictly before the next local midnight. Later records never leak into an earlier snapshot.</li>
      <li><b>Currently confirmed</b>: latest stage is partner_confirmed (24 at 20 Apr 2025). <b>Ever confirmed</b> includes O006, confirmed then withdrawn (25).</li>
      <li><b>Proposal brands vs opportunities</b>: 45 brands, 46 opportunities (one brand has two).</li>
      <li><b>Signed value</b>: the reported confirmed amount, split cash-support vs in-kind. Not proof of payment. <b>Receipts</b>: unavailable in the workbook; in Execution mode only recorded receipts (cleared before fest start) count, and they are not a bank balance.</li>
      <li><b>Recorded activity share</b>: share of recorded interaction events by route (82.3% cold outbound). A proxy, not hours.</li>
      <li><b>Days in current stage</b>: since the start of the latest consecutive run of the current stage. <b>Days since meaningful activity</b>: since the latest reply, intro, inbound or meeting.</li>
      <li><b>Target in force</b>: stepwise by effective date: 20 confirmed partnerships until 14 Mar 2025, 28 from 15 Mar (17 qualified brands in both).</li>
      <li><b>Naive pooled closure scenario</b>: 24/32 resolved proposals closed (75%), applied to open deals. Timing excluded; not a forecast.</li>
      <li><b>Interview reference scenario (deck: "Today")</b>: interview-informed model, not observed in the dataset. Computed exactly as ₹33.49025L (the handoff table's 33.48825 is a 0.002 arithmetic slip; both display as ₹33.5L).</li>
      <li><b>Evidence classes</b>: D dataset · I interviews · A assumption · U user entry · SIM simulated.</li></ul>
    <h3>Rules (deck slide 3) and interpretation</h3>${table(RULES.map(r => ({ bet: r.bet, metric: r.metric, ...r.published, interpretation: r.interpretation })), [['bet', 'Bet'], ['metric', 'Metric'], ['stop', 'Stop'], ['change', 'Change'], ['plan', 'Plan'], ['scale', 'Scale'], ['interpretation', 'Interpretation (A)']])}
    <h3>Campaign heuristics</h3><ul class="qual small">${Object.entries(CAMPAIGN_HEURISTICS).map(([k, v]) => `<li><b>${k}</b>: ${esc(v)}</li>`).join('')}</ul>
    <h3>Data quality</h3>${table(A.quality, [['check', 'Check'], ['value', 'Value']])}
    <h3>What the data cannot show</h3><ul class="qual small"><li>Bank balance, invoices, payment dates (historical)</li><li>Why a sponsor decided (motivations)</li><li>Attendance uplift from activations</li><li>Tax or legal treatment (TDS 2% is a plan assumption)</li><li>Campaign spend unless entered in the app</li></ul>`;
}

// ---------- copilot ----------
const EXAMPLES = {
  historical: ['How are we doing against target, and why did attainment drop in mid-March?', 'Which campaigns produce wins and which only produce activity?', 'Which open proposals are most at risk? Draft follow-up tasks for the top three.', 'How much cash have we received?', 'Why did sponsors choose us?'],
  plan: ['Explain the bridge from ₹44.5L to ₹72.7L.', 'What happens to the aim if no title advance is collected?', 'How do the planned deal sizes compare with 2025?'],
  execution: ['Which trigger cards need a decision this week?', 'How much is due before the fest but not received?', 'What is our bank balance?', 'Draft tasks for the overdue installments.'],
};
function renderExamples() { $('#examples').innerHTML = EXAMPLES[mode].map(q => `<button type="button">${esc(q)}</button>`).join(''); $$('#examples button').forEach(b => b.onclick = () => ask(b.textContent)); }
function buildSnapshot() { return snapshotForAI(A, { tasks: tasks(), exec: mode === 'execution' ? EX : null, mode, snapshot_id: curSnapshotId(), records }); }
async function ask(q) {
  chat.push({ role: 'user', text: q }); chat.push({ role: 'assistant', pending: true }); renderChat();
  const sid = curSnapshotId();
  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, snapshot: buildSnapshot(), scope: lastScope,
      history: chat.filter(m => !m.pending).slice(0, -1).map(m => ({ role: m.role, text: m.role === 'assistant' ? (m.out?.answer || m.text || '') : m.text })) }) });
    const j = await r.json(); chat.pop();
    if (!r.ok) chat.push({ role: 'assistant', text: j.error || 'Request failed', error: true, sid });
    else { if (j.scope && j.scope.ids && j.scope.ids.length) lastScope = j.scope; chat.push({ role: 'assistant', out: j, sid: j.snapshot_id || sid, drafts: (j.suggested_tasks || []).map(t => ({ ...t, due: addDaysStr(asOf(), Number(t.due_days) || 3), idem: 'ai-' + E.hash((j.snapshot_id || sid) + '|' + t.title + '|' + (t.linked || '')) })) }); }
  } catch (e) { chat.pop(); chat.push({ role: 'assistant', text: 'Network error: ' + e.message, error: true, sid }); }
  renderChat();
}
function renderChat() {
  const have = new Set(tasks().map(t => t.idem));
  $('#log').innerHTML = chat.map((m, mi) => {
    if (m.role === 'user') return `<div class="msg u">${esc(m.text)}</div>`;
    if (m.pending) return `<div class="msg a">Working through the data…</div>`;
    if (!m.out) return `<div class="msg a no">${esc(m.text)}<div class="sid">snapshot ${esc(m.sid)}</div></div>`;
    const o = m.out; const sec = (k, v) => v && (Array.isArray(v) ? v.length : true) ? `<div class="k">${k}</div>${Array.isArray(v) ? `<ul class="ev">${v.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : `<div>${esc(v)}</div>`}` : '';
    return `<div class="msg a ${o.answerable === 'no' ? 'no' : ''}"><div>${esc(o.answer)}</div>${o.answerable !== 'yes' ? badge(o.answerable === 'no' ? 'not answerable from data' : 'partly answerable', true) : ''}
      ${sec('Evidence', o.evidence)}${sec('Calculation', o.calculation)}${sec('Interpretation', o.interpretation)}${sec('Missing', o.missing)}${sec('Next action', o.next_action)}
      ${(m.drafts || []).map((t, ti) => `<div class="preview"><div class="k">Draft task</div>${have.has(t.idem) ? `<b>${esc(t.title)}</b> · saved ✓` : `<input data-df="${mi}:${ti}:title" value="${esc(t.title)}" style="width:100%"><input data-df="${mi}:${ti}:owner" value="${esc(t.owner || '')}" placeholder="Owner"><input data-df="${mi}:${ti}:due" type="date" value="${t.due}"><div class="small muted">${esc(t.linked || '')} ${esc(t.reason || '')}</div><button class="sm" data-cf="${mi}:${ti}">Confirm task</button>`}</div>`).join('')}
      ${(o.steps || []).length ? `<details><summary>Tool steps (${o.steps.length})</summary>${o.steps.map(s => `<code>${esc(s.tool)} ${esc(JSON.stringify(s.args))}\n→ ${esc(s.result_preview)}</code>`).join('')}</details>` : ''}
      <div class="sid">snapshot ${esc(m.sid)} · ${esc(o.model || '')}${m.sid !== curSnapshotId() ? ' · <b>data changed since this answer</b>' : ''}</div></div>`;
  }).join('') || `<p class="muted small">Ask a question, or pick an example below. ${config.ai ? '' : '<b>AI is not configured on this deployment.</b>'}</p>`;
  $('#log').scrollTop = 1e9;
  $$('[data-df]').forEach(inp => inp.oninput = () => { const [mi, ti, f] = inp.dataset.df.split(':'); chat[mi].drafts[ti][f] = inp.value; });
  $$('[data-cf]').forEach(b => b.onclick = async () => { b.disabled = true; const [mi, ti] = b.dataset.cf.split(':'); const t = chat[mi].drafts[ti];
    if (tasks().some(x => x.idem === t.idem)) return renderChat();
    await store.put({ id: t.idem, kind: 'task', data: { status: 'todo', source: 'copilot', title: t.title, owner: t.owner, linked: t.linked, due: t.due, idem: t.idem, snapshot_id: chat[mi].sid } }); render(); });
}

function table(rows, cols) {
  if (!rows || !rows.length) return '<p class="muted small">No rows.</p>';
  return `<div class="tbl"><table><thead><tr>${cols.map(c => `<th>${esc(c[1])}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(([k, , f]) => { const v = r[k]; return `<td${typeof v === 'number' ? ' class="n"' : ''}>${f ? f(v, r) : esc(v ?? '—')}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

boot();
