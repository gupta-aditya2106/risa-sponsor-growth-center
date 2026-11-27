// RISA Sponsor Growth Center: one deterministic analytics engine shared by the dashboard,
// the AI copilot's tools and the tests. Pure functions only.
//
// Evidence classes used in labels: D dataset (synthetic CampusFest 2025 workbook),
// I interview inputs, A plan/implementation assumption, U user-entered app record, SIM simulated demo data.
//
// Dataset rules (from its own Read me): the selected date means END of that day in Asia/Kolkata
// (implemented as "strictly before the next local midnight"); dedupe identical stable IDs and flag
// conflicting payloads; take the latest eligible full-state version per entity; never sum history
// states; a later outcome must not leak into an earlier snapshot; partnership value is a reported
// amount, not proof of bank receipt.

export const RULE_VERSION = 'deck-v12+impl-A1';
export const PLAN_VERSION = 'deck-v12-frozen';
export const STAGES = ['prospecting', 'contacted', 'proposal_sent', 'negotiating', 'partner_confirmed', 'lost', 'withdrawn'];
export const EVENT_TYPES = ['outreach_sent', 'delivered', 'replied', 'introduction_received', 'web_inbound', 'meeting_booked', 'meeting_held', 'opt_out'];
const OPEN_LATE = ['proposal_sent', 'negotiating'];
const MEANINGFUL = ['replied', 'introduction_received', 'web_inbound', 'meeting_booked', 'meeting_held'];
// Route labels: warm introductions and inbound are different routes (SC04 is inbound, not a warm intro).
export const ROUTE_OF_CHANNEL = { introduction: 'warm introduction', referral: 'warm introduction', renewal: 'renewal', web_inbound: 'inbound', email: 'cold outbound', linkedin: 'cold outbound', event: 'other', other: 'other' };
const isRelationshipRoute = r => r === 'warm introduction' || r === 'inbound' || r === 'renewal';

// ---------- helpers ----------
export const addDaysStr = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const cutoffFor = dateStr => addDaysStr(dateStr, 1) + 'T00:00:00'; // exclusive upper bound
const before = (ts, cutoff) => { if (ts == null || ts === '') return false; const x = String(ts); return (x.length === 10 ? x + 'T00:00:00' : x) < cutoff; };
const day = ts => String(ts).slice(0, 10);
const daysBetween = (a, b) => Math.floor((Date.parse(String(b).slice(0, 19) + 'Z') - Date.parse(String(a).slice(0, 19) + 'Z')) / 86400000);
const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const pct = (a, b) => (b ? Math.round(1000 * a / b) / 10 : null);
const r4 = v => Math.round(v * 1e4) / 1e4;
const stable = o => JSON.stringify(o, Object.keys(o).sort());
export function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }

function dedupe(rows, key) {
  const seen = new Map(); let dupes = 0; const conflicts = [];
  for (const r of rows || []) {
    const k = r[key]; if (k == null) continue;
    if (seen.has(k)) {
      if (stable(seen.get(k)) === stable(r)) dupes++;
      else conflicts.push({ id: k, kept: 'first occurrence', note: 'same ID, different payload' });
      continue;
    }
    seen.set(k, r);
  }
  return { rows: [...seen.values()], dupes, conflicts, raw: (rows || []).length };
}
const latestBy = (rows, idKey, dateKey, cutoff) => {
  const out = new Map();
  for (const r of rows) {
    if (!before(r[dateKey], cutoff)) continue;
    const cur = out.get(r[idKey]);
    // tie rule: later timestamp wins; on equal timestamps the higher app revision wins, else the first source row is kept
    if (!cur || r[dateKey] > cur[dateKey] || (r[dateKey] === cur[dateKey] && (r.app_revision || 0) > (cur.app_revision || 0))) out.set(r[idKey], r);
  }
  return out;
};

export function defaultDate(sheets) {
  const ev = (sheets.Event || [])[0];
  return ev && ev.history_end ? day(ev.history_end) : new Date().toISOString().slice(0, 10);
}

// ---------- dataset validation for uploads (staging → validate → preview → adopt) ----------
export const REQUIRED = {
  Brands: ['brand_id', 'brand_name', 'industry', 'created_at'],
  'Sponsor campaigns': ['sponsor_campaign_id', 'campaign_name', 'channel', 'owner_name'],
  'Sponsor interactions': ['interaction_id', 'brand_id', 'event_type', 'occurred_at', 'sponsor_campaign_id'],
  'Partner opportunities': ['opportunity_id', 'brand_id', 'support_type', 'created_at', 'originating_campaign_name'],
  'Opportunity history': ['history_id', 'opportunity_id', 'stage', 'proposed_value_inr', 'confirmed_value_inr', 'effective_at'],
  Targets: ['effective_at', 'confirmed_partnerships_goal', 'qualified_brands_goal'],
};
export function validateSheets(S) {
  const errors = [], warnings = [];
  for (const [sheet, cols] of Object.entries(REQUIRED)) {
    if (!S[sheet]) { errors.push(`Missing sheet "${sheet}"`); continue; }
    const have = new Set(Object.keys(S[sheet][0] || {}));
    const miss = cols.filter(c => !have.has(c));
    if (miss.length) errors.push(`${sheet}: missing columns ${miss.join(', ')}`);
  }
  if (!errors.length) {
    const badStage = S['Opportunity history'].filter(h => !STAGES.includes(h.stage));
    if (badStage.length) errors.push(`Opportunity history: ${badStage.length} rows with unknown stage (e.g. "${badStage[0].stage}")`);
    const badNum = S['Opportunity history'].filter(h => Number.isNaN(Number(h.proposed_value_inr)) || Number.isNaN(Number(h.confirmed_value_inr ?? 0)));
    if (badNum.length) errors.push(`Opportunity history: ${badNum.length} non-numeric amounts`);
    const badDate = S['Sponsor interactions'].filter(e => !/^\d{4}-\d{2}-\d{2}/.test(String(e.occurred_at)));
    if (badDate.length) errors.push(`Sponsor interactions: ${badDate.length} rows with invalid dates`);
    const opps = new Set(S['Partner opportunities'].map(o => o.opportunity_id));
    const orphan = S['Opportunity history'].filter(h => !opps.has(h.opportunity_id));
    if (orphan.length) warnings.push(`${orphan.length} history rows reference unknown opportunities (ignored)`);
    const unk = S['Sponsor interactions'].filter(e => !EVENT_TYPES.includes(e.event_type));
    if (unk.length) warnings.push(`${unk.length} interactions with unrecognised event types (counted as activity only)`);
  }
  return { ok: !errors.length, errors, warnings };
}
export function datasetVersion(S) {
  const sig = Object.keys(S).sort().map(k => `${k}:${(S[k] || []).length}:${hash(JSON.stringify((S[k] || []).slice(0, 3)) + JSON.stringify((S[k] || []).slice(-3)))}`).join('|');
  return 'ds-' + hash(sig);
}

// ---------- in-app overlays: appended as new dated rows, never overwriting the source ----------
export function applyEdits(sheets, records = []) {
  const recs = records.filter(r => ['campaign', 'opp_new', 'opp_update', 'interaction'].includes(r.kind));
  if (!recs.length) return sheets;
  const s = { ...sheets };
  const add = (name, row) => { s[name] = [...(s[name] || []), row]; };
  const brandByName = new Map((sheets.Brands || []).map(b => [String(b.brand_name).toLowerCase(), b]));
  const campByName = new Map((sheets['Sponsor campaigns'] || []).map(c => [c.campaign_name, c]));
  const sorted = [...recs].sort((a, b) => String(a.data.at || '').localeCompare(String(b.data.at || '')) || (a.revision || 0) - (b.revision || 0));
  sorted.forEach((r, i) => {
    const d = r.data || {};
    if (r.kind === 'campaign' && !campByName.has(d.campaign_name)) {
      const row = { campaign_name: d.campaign_name, channel: d.channel, objective: d.objective || null, audience: null, owner_name: d.owner_name || null,
        planned_start_at: d.planned_start_at || d.at, planned_end_at: d.planned_end_at || null, created_at: d.at, sponsor_campaign_id: r.id, owner_id: null, app_created: true };
      add('Sponsor campaigns', row); campByName.set(row.campaign_name, row);
    }
    if (r.kind === 'opp_new') {
      let b = brandByName.get(String(d.brand_name).toLowerCase());
      if (!b) { b = { brand_name: d.brand_name, industry: d.industry || 'Not set', owner_name: d.owner_name, created_at: d.at, brand_id: 'B-' + r.id, owner_id: null, app_created: true }; add('Brands', b); brandByName.set(String(d.brand_name).toLowerCase(), b); }
      add('Partner opportunities', { opportunity_name: `${d.brand_name} festival partnership`, brand_name: d.brand_name, primary_contact_name: null, originating_campaign_name: d.campaign_name,
        support_type: d.support_type || 'cash', created_at: d.at, opportunity_id: r.id, brand_id: b.brand_id, primary_contact_id: null, sponsor_campaign_id: campByName.get(d.campaign_name)?.sponsor_campaign_id || null, app_created: true });
      add('Opportunity history', { opportunity_name: `${d.brand_name} festival partnership`, brand_name: d.brand_name, stage: d.stage || 'prospecting',
        proposed_value_inr: Number(d.proposed_value_inr) || 0, confirmed_value_inr: d.stage === 'partner_confirmed' ? Number(d.confirmed_value_inr ?? d.proposed_value_inr) || 0 : 0,
        owner_name: d.owner_name, effective_at: d.at, history_id: 'H-' + r.id, opportunity_id: r.id, brand_id: b.brand_id, owner_id: null, app_created: true, app_revision: 1e6 + i });
    }
    if (r.kind === 'opp_update') {
      add('Opportunity history', { opportunity_name: d.opportunity_name || null, brand_name: d.brand_name, stage: d.stage,
        proposed_value_inr: Number(d.proposed_value_inr) || 0, confirmed_value_inr: d.stage === 'partner_confirmed' ? Number(d.confirmed_value_inr) || 0 : 0,
        owner_name: d.owner_name, effective_at: d.at, history_id: r.id, opportunity_id: d.opportunity_id, brand_id: d.brand_id, owner_id: null, note: d.note || null, app_created: true, app_revision: 1e6 + i });
    }
    if (r.kind === 'interaction') {
      const b = brandByName.get(String(d.brand_name).toLowerCase()) || {};
      const c = campByName.get(d.campaign_name) || {};
      add('Sponsor interactions', { brand_name: d.brand_name, contact_name: null, campaign_name: d.campaign_name, channel: c.channel || null,
        event_type: d.event_type, outcome: null, summary: d.summary || 'Logged in the Growth Center', occurred_at: d.at, interaction_id: r.id,
        attempt_id: 'AT-' + r.id, origin_interaction_id: null, brand_id: b.brand_id || null, contact_id: null, sponsor_campaign_id: c.sponsor_campaign_id || null, owner_id: null, app_created: true });
    }
  });
  return s;
}

// ---------- historical snapshot ----------
function snapshot(sheets, dateStr, meta = {}) {
  const cutoff = cutoffFor(dateStr);
  const I = dedupe(sheets['Sponsor interactions'], 'interaction_id');
  const Q = dedupe(sheets['Brand qualification'], 'history_id');
  const H = dedupe(sheets['Opportunity history'], 'history_id');
  const quality = [
    { check: 'Raw interaction rows', value: I.raw }, { check: 'Duplicate interaction IDs removed (identical payload)', value: I.dupes },
    { check: 'Duplicate qualification IDs removed', value: Q.dupes }, { check: 'Duplicate opportunity-history IDs removed', value: H.dupes },
    { check: 'Conflicting payloads under one ID (flagged, first kept)', value: I.conflicts.length + Q.conflicts.length + H.conflicts.length },
  ];
  const conflicts = [...I.conflicts.map(c => ({ sheet: 'Sponsor interactions', ...c })), ...Q.conflicts.map(c => ({ sheet: 'Brand qualification', ...c })), ...H.conflicts.map(c => ({ sheet: 'Opportunity history', ...c }))];

  const allBrands = sheets.Brands || [];
  const brands = allBrands.filter(b => !b.created_at || before(b.created_at, cutoff));
  const brandById = new Map(allBrands.map(b => [b.brand_id, b]));
  const opps = (sheets['Partner opportunities'] || []).filter(o => !o.created_at || before(o.created_at, cutoff));
  const oppById = new Map(opps.map(o => [o.opportunity_id, o]));
  const campaigns = (sheets['Sponsor campaigns'] || []).filter(c => !c.app_created || before(c.created_at, cutoff));
  const events = I.rows.filter(e => before(e.occurred_at, cutoff));
  const hist = H.rows.filter(h => oppById.has(h.opportunity_id) && before(h.effective_at, cutoff)).sort((a, b) => String(a.effective_at).localeCompare(String(b.effective_at)));
  const latestOpp = latestBy(hist, 'opportunity_id', 'effective_at', cutoff);
  const latestQual = latestBy(Q.rows, 'brand_id', 'effective_at', cutoff);

  // per-opportunity history facts
  const byOpp = new Map();
  for (const h of hist) { if (!byOpp.has(h.opportunity_id)) byOpp.set(h.opportunity_id, []); byOpp.get(h.opportunity_id).push(h); }
  const lastActivityByBrand = new Map();
  for (const e of events) if (MEANINGFUL.includes(e.event_type)) { const cur = lastActivityByBrand.get(e.brand_id); if (!cur || e.occurred_at > cur) lastActivityByBrand.set(e.brand_id, e.occurred_at); }

  const oppRows = [...latestOpp.values()].map(h => {
    const o = oppById.get(h.opportunity_id) || {};
    const b = brandById.get(h.brand_id || o.brand_id) || {};
    const hs = byOpp.get(h.opportunity_id) || [];
    const stages = new Set(hs.map(x => x.stage));
    // entered current stage = start of the latest consecutive run of the current stage
    let entered = h.effective_at;
    for (let i = hs.length - 1; i >= 0; i--) { if (hs[i].stage === h.stage) entered = hs[i].effective_at; else break; }
    const firstConfirm = hs.find(x => x.stage === 'partner_confirmed');
    const camp = (campaigns.find(c => c.campaign_name === o.originating_campaign_name)) || {};
    const lastAct = lastActivityByBrand.get(h.brand_id || o.brand_id);
    return {
      opportunity_id: h.opportunity_id, brand: h.brand_name || o.brand_name, brand_id: h.brand_id || o.brand_id, industry: b.industry || null,
      campaign: o.originating_campaign_name || null, campaign_id: camp.sponsor_campaign_id || o.sponsor_campaign_id || null,
      route: ROUTE_OF_CHANNEL[camp.channel] || 'other', support_type: o.support_type || null,
      stage: h.stage, proposed_inr: Number(h.proposed_value_inr) || 0, confirmed_inr: h.stage === 'partner_confirmed' ? (Number(h.confirmed_value_inr) || 0) : 0,
      owner: h.owner_name, last_state_record: day(h.effective_at),
      days_in_current_stage: daysBetween(entered, cutoff), days_since_state_record: daysBetween(h.effective_at, cutoff),
      days_since_meaningful_activity: lastAct ? daysBetween(lastAct, cutoff) : null, last_meaningful_activity: lastAct ? day(lastAct) : null,
      ever_proposal_sent: stages.has('proposal_sent'), ever_reached_proposal: ['proposal_sent', 'negotiating', 'partner_confirmed'].some(s => stages.has(s)),
      ever_confirmed: stages.has('partner_confirmed'), first_confirmed_at: firstConfirm ? day(firstConfirm.effective_at) : null,
      edited_in_app: hs.some(x => x.app_created),
    };
  }).sort((a, b) => a.opportunity_id.localeCompare(b.opportunity_id));

  const signed = oppRows.filter(o => o.stage === 'partner_confirmed');
  const open = oppRows.filter(o => OPEN_LATE.includes(o.stage));
  const stageCounts = Object.fromEntries(STAGES.map(s => [s, oppRows.filter(o => o.stage === s).length]));

  // Brand funnel with cohort membership (each step counts only brands that were in the previous step)
  const evByType = t => new Set(events.filter(e => e.event_type === t).map(e => e.brand_id));
  const prospectSet = new Set(brands.map(b => b.brand_id));
  const replied = evByType('replied'), met = evByType('meeting_held');
  const proposalBrands = new Set(oppRows.filter(o => o.ever_proposal_sent).map(o => o.brand_id));
  const confirmedBrands = new Set(signed.map(o => o.brand_id));
  const inter = (a, b) => [...a].filter(x => b.has(x));
  const brandSteps = [['Prospect brands', prospectSet], ['Brands that replied', replied], ['Brands with a held meeting', met], ['Brands with a proposal sent', proposalBrands], ['Brands currently confirmed', confirmedBrands]];
  const brandFunnel = brandSteps.map(([stage, set], i) => {
    const prev = i ? brandSteps[i - 1][1] : null;
    const inPrev = prev ? inter(set, prev).length : null;
    return { stage, unit: 'brands', value: set.size, also_in_previous_step: inPrev, cohort_conversion_pct: prev ? pct(inPrev, prev.size) : null };
  });
  const oppFunnel = [
    { stage: 'Opportunities created', unit: 'opportunities', value: oppRows.length },
    { stage: 'Ever sent a proposal', unit: 'opportunities', value: oppRows.filter(o => o.ever_proposal_sent).length },
    { stage: 'Ever confirmed (incl. later withdrawn)', unit: 'opportunities', value: oppRows.filter(o => o.ever_confirmed).length },
    { stage: 'Currently confirmed', unit: 'opportunities', value: signed.length },
  ].map((s, i, a) => ({ ...s, conversion_from_previous_pct: i ? pct(s.value, a[i - 1].value) : null }));
  const deckFunnel = [
    { stage: 'Prospects', unit: 'brands', value: prospectSet.size }, { stage: 'Conversations (held meetings)', unit: 'brands', value: met.size },
    { stage: 'Proposals', unit: 'opportunities (unit changes here)', value: oppRows.filter(o => o.ever_proposal_sent).length },
    { stage: 'Signed', unit: 'opportunities', value: signed.length }];

  // Campaign scorecard (heuristic calls are configurable diagnostics, not the deck's six governance rules)
  const campMeta = meta.campaigns || {};
  const totalEvents = events.length || 1;
  const byCampaign = campaigns.map(c => {
    const ev = events.filter(e => e.sponsor_campaign_id === c.sponsor_campaign_id || (!e.sponsor_campaign_id && e.campaign_name === c.campaign_name));
    const os = oppRows.filter(o => o.campaign === c.campaign_name);
    const wins = os.filter(o => o.stage === 'partner_confirmed');
    const touched = new Set(ev.map(e => e.brand_id)), rep = new Set(ev.filter(e => e.event_type === 'replied').map(e => e.brand_id)), mt = new Set(ev.filter(e => e.event_type === 'meeting_held').map(e => e.brand_id));
    const m = campMeta[c.campaign_name] || {};
    const route = ROUTE_OF_CHANNEL[c.channel] || 'other';
    const openOs = os.filter(o => OPEN_LATE.includes(o.stage));
    const row = {
      campaign_id: c.sponsor_campaign_id, campaign: c.campaign_name, channel: c.channel, route, owner: m.owner || c.owner_name,
      status: m.status || (c.planned_end_at && String(c.planned_end_at) < cutoff ? 'ended' : 'active'), app_created: Boolean(c.app_created),
      recorded_events: ev.length, attempts: new Set(ev.map(e => e.attempt_id)).size, activity_share_pct: Math.round(1000 * ev.length / totalEvents) / 10,
      brands_touched: touched.size, brands_replied: rep.size, brands_met: mt.size,
      reply_rate: `${rep.size}/${touched.size}`, reply_rate_pct: pct(rep.size, touched.size), meeting_rate: `${mt.size}/${touched.size}`, meeting_rate_pct: pct(mt.size, touched.size),
      opportunities: os.length, current_wins: wins.length, win_per_opportunity: `${wins.length}/${os.length}`, win_per_opportunity_pct: pct(wins.length, os.length),
      lost: os.filter(o => o.stage === 'lost').length, withdrawn: os.filter(o => o.stage === 'withdrawn').length,
      signed_cash_support_inr: sum(wins.filter(o => o.support_type === 'cash'), o => o.confirmed_inr), signed_in_kind_inr: sum(wins.filter(o => o.support_type !== 'cash'), o => o.confirmed_inr),
      open_proposal_value_inr: sum(openOs, o => o.proposed_inr), open_proposals: openOs.length, oldest_stage_age_days: openOs.length ? Math.max(...openOs.map(o => o.days_in_current_stage)) : null,
      budget_inr: m.budget_inr ?? null, spent_inr: m.spent_inr ?? null,
    };
    row.cost_per_current_win_inr = row.spent_inr == null ? null : wins.length ? Math.round(row.spent_inr / wins.length) : 'undefined (0 wins)';
    Object.assign(row, campaignHeuristic(row));
    return row;
  });

  const inds = [...new Set(brands.map(b => b.industry).filter(Boolean))].sort();
  const byIndustry = inds.map(ind => { const os = oppRows.filter(o => o.industry === ind); const w = os.filter(o => o.stage === 'partner_confirmed');
    return { industry: ind, brands: brands.filter(b => b.industry === ind).length, opportunities: os.length, current_wins: w.length, signed_inr: sum(w, o => o.confirmed_inr), lost: os.filter(o => o.stage === 'lost').length, open_proposal_value_inr: sum(os.filter(o => OPEN_LATE.includes(o.stage)), o => o.proposed_inr) }; });
  const owners = [...new Set(oppRows.map(o => o.owner).filter(Boolean))].sort().map(n => { const os = oppRows.filter(o => o.owner === n); const w = os.filter(o => o.stage === 'partner_confirmed');
    return { owner: n, opportunities: os.length, current_wins: w.length, win_per_opportunity: `${w.length}/${os.length}`, signed_inr: sum(w, o => o.confirmed_inr), open_proposals: os.filter(o => OPEN_LATE.includes(o.stage)).length, open_proposal_value_inr: sum(os.filter(o => OPEN_LATE.includes(o.stage)), o => o.proposed_inr) }; });

  const targets = (sheets.Targets || []).slice().sort((a, b) => String(a.effective_at).localeCompare(String(b.effective_at)));
  const target = targets.filter(t => before(t.effective_at, cutoff)).pop() || null;

  // Naive pooled closure scenario: diagnostic only, timing excluded, not a pre-fest forecast
  const resolved = oppRows.filter(o => o.ever_reached_proposal && ['partner_confirmed', 'lost', 'withdrawn'].includes(o.stage));
  const rate = resolved.length ? resolved.filter(o => o.stage === 'partner_confirmed').length / resolved.length : null;
  const naive = { label: 'Naive pooled closure scenario (timing excluded; not a pre-fest cash forecast)',
    pooled_rate_pct: rate == null ? null : Math.round(1000 * rate) / 10, resolved_sample: `${resolved.filter(o => o.stage === 'partner_confirmed').length}/${resolved.length}`,
    expected_partnerships: rate == null ? null : r4(signed.length + open.length * rate), expected_reported_value_inr: rate == null ? null : Math.round(sum(signed, o => o.confirmed_inr) + sum(open, o => o.proposed_inr) * rate),
    caveat: 'Resolved deals are a selected subset; all open deals come from campaigns with no current wins; reported value includes in-kind and says nothing about payment timing.' };

  const relEvents = sum(byCampaign.filter(c => !isRelationshipRoute(c.route)), c => c.recorded_events);
  const signedValue = sum(signed, o => o.confirmed_inr);
  const kpis = {
    as_of: dateStr, cutoff_exclusive: cutoff,
    prospect_brands: brands.length, contacts: (sheets['Sponsor contacts'] || []).filter(c => !c.created_at || before(c.created_at, cutoff)).length,
    recorded_events: events.length, outreach_attempts: new Set(events.map(e => e.attempt_id)).size,
    replied_brands: replied.size, brands_with_held_meeting: met.size, qualified_brands_now: [...latestQual.values()].filter(q => q.qualification_status === 'qualified').length,
    opportunities: oppRows.length, proposal_opportunities: oppRows.filter(o => o.ever_proposal_sent).length, proposal_brands: proposalBrands.size,
    current_confirmed: signed.length, ever_confirmed: oppRows.filter(o => o.ever_confirmed).length, stage_counts: stageCounts,
    signed_value_inr: signedValue, signed_cash_support_inr: sum(signed.filter(o => o.support_type === 'cash'), o => o.confirmed_inr), signed_in_kind_inr: sum(signed.filter(o => o.support_type !== 'cash'), o => o.confirmed_inr),
    average_signed_deal_inr: signed.length ? Math.round(signedValue / signed.length) : null,
    open_proposals: open.length, open_proposal_value_inr: sum(open, o => o.proposed_inr), open_stage_age_14plus: open.filter(o => o.days_in_current_stage >= 14).length,
    open_state_record_age_14plus: open.filter(o => o.days_since_state_record >= 14).length,
    lost: stageCounts.lost, withdrawn: stageCounts.withdrawn,
    withdrawn_after_confirming: oppRows.filter(o => o.stage === 'withdrawn' && o.ever_confirmed).map(o => ({ id: o.opportunity_id, brand: o.brand, confirmed_on: o.first_confirmed_at, withdrawn_on: o.last_state_record, value_inr: o.proposed_inr })),
    cold_outbound_activity_share_pct: Math.round(1000 * relEvents / totalEvents) / 10, cold_outbound_events: relEvents,
    cold_outbound_current_wins: sum(byCampaign.filter(c => !isRelationshipRoute(c.route)), c => c.current_wins),
    relationship_inbound_current_wins: sum(byCampaign.filter(c => isRelationshipRoute(c.route)), c => c.current_wins),
    target_version: target ? target.target_version : null, target_effective: target ? day(target.effective_at) : null,
    target_confirmed: target ? target.confirmed_partnerships_goal : null, target_qualified: target ? target.qualified_brands_goal : null,
    confirmed_vs_target: target ? `${signed.length}/${target.confirmed_partnerships_goal}` : null, confirmed_vs_target_pct: target ? pct(signed.length, target.confirmed_partnerships_goal) : null,
    receipts_status: 'unavailable', receipts_note: 'The workbook has no payment, invoice or bank records. Signed cash-support value is not cash received.',
    campaign_budget_inr: sum(byCampaign.filter(c => c.budget_inr != null), c => c.budget_inr), campaign_spent_inr: sum(byCampaign.filter(c => c.spent_inr != null), c => c.spent_inr),
    campaigns_with_spend_entered: byCampaign.filter(c => c.spent_inr != null).length,
  };
  return { cutoff, kpis, brandFunnel, oppFunnel, deckFunnel, byCampaign, byIndustry, owners, oppRows, open, signed, quality, conflicts, naive, events, hist, targets };
}

export const CAMPAIGN_HEURISTICS = {
  note: 'Configurable app heuristics for historical diagnosis, not the deck\'s six governance rules.',
  stop: '≥50 recorded events and 0 current wins, or more than half the entered budget spent with 0 wins',
  scale: '≥2 current wins and win/opportunity ≥30% (small samples: shown with counts)',
  change: 'Has opportunities but win/opportunity <30%, or open proposals ageing',
  watch: 'Too little activity to judge',
};
function campaignHeuristic(c) {
  const halfSpent = c.budget_inr && c.spent_inr != null && c.spent_inr > 0.5 * c.budget_inr;
  if ((c.recorded_events >= 50 && c.current_wins === 0) || (halfSpent && c.current_wins === 0)) return { heuristic_call: 'deprioritise', heuristic_reason: c.recorded_events >= 50 ? `${c.recorded_events} recorded events, 0 current wins` : 'over half the entered budget spent, 0 wins' };
  if (c.current_wins >= 2 && (c.win_per_opportunity_pct || 0) >= 30) return { heuristic_call: 'scale', heuristic_reason: `${c.win_per_opportunity} won (${c.win_per_opportunity_pct}%)` };
  if (c.opportunities > 0) return { heuristic_call: 'change', heuristic_reason: c.open_proposals ? `${c.open_proposals} open proposals, oldest ${c.oldest_stage_age_days}d in stage` : `win/opp ${c.win_per_opportunity}` };
  return { heuristic_call: 'watch', heuristic_reason: `${c.recorded_events} events so far` };
}

// Weekly series (Monday-start IST weeks) with the target in force at each week end
function weekly(sheets, a, dateStr) {
  const ev = (sheets.Event || [])[0];
  const start = ev && ev.history_start ? day(ev.history_start) : (a.events.map(e => day(e.occurred_at)).sort()[0] || dateStr);
  const s = new Date(start + 'T12:00:00Z'); s.setUTCDate(s.getUTCDate() - ((s.getUTCDay() + 6) % 7));
  const out = []; const firstConf = new Map();
  a.hist.forEach(h => { if (h.stage === 'partner_confirmed' && !firstConf.has(h.opportunity_id)) firstConf.set(h.opportunity_id, h); });
  for (let d = s.toISOString().slice(0, 10); d <= dateStr; d = addDaysStr(d, 7)) {
    const end = addDaysStr(d, 6) < dateStr ? addDaysStr(d, 6) : dateStr;
    const lo = d + 'T00:00:00', hi = cutoffFor(end);
    const evs = a.events.filter(x => x.occurred_at >= lo && x.occurred_at < hi);
    const confs = [...firstConf.values()].filter(h => h.effective_at >= lo && h.effective_at < hi);
    const tgt = a.targets.filter(t => before(t.effective_at, hi)).pop();
    out.push({ week_start: d, week_end: end, complete_week: addDaysStr(d, 6) <= dateStr, recorded_events: evs.length, replies: evs.filter(x => x.event_type === 'replied').length,
      held_meetings: evs.filter(x => x.event_type === 'meeting_held').length, first_confirmations: confs.length, first_confirmed_value_inr: sum(confs, h => h.confirmed_value_inr),
      target_confirmed_in_force: tgt ? tgt.confirmed_partnerships_goal : null });
  }
  let cum = 0; out.forEach(w => { cum += w.first_confirmations; w.cumulative_ever_confirmed = cum; });
  return out;
}

// Entity-level comparison between two snapshots (never inferred from totals)
export function compareSnapshots(a, b) {
  const items = [];
  const A = new Map(a.oppRows.map(o => [o.opportunity_id, o])), B = new Map(b.oppRows.map(o => [o.opportunity_id, o]));
  for (const [id, o] of B) {
    const p = A.get(id);
    if (!p) { items.push({ type: 'new opportunity', id, brand: o.brand, detail: `created, now ${o.stage}`, signed_delta_inr: o.confirmed_inr, confirmed_delta: o.stage === 'partner_confirmed' ? 1 : 0 }); continue; }
    if (p.stage !== o.stage) {
      const cd = (o.stage === 'partner_confirmed') - (p.stage === 'partner_confirmed');
      items.push({ type: cd > 0 ? 'new confirmation' : cd < 0 ? 'removed confirmation' : 'stage move', id, brand: o.brand, detail: `${p.stage} → ${o.stage}`, signed_delta_inr: o.confirmed_inr - p.confirmed_inr, confirmed_delta: cd });
    } else if (o.stage === 'partner_confirmed' && o.confirmed_inr !== p.confirmed_inr) items.push({ type: 'value change', id, brand: o.brand, detail: `confirmed value ${p.confirmed_inr} → ${o.confirmed_inr}`, signed_delta_inr: o.confirmed_inr - p.confirmed_inr, confirmed_delta: 0 });
    else if (OPEN_LATE.includes(o.stage) && o.proposed_inr !== p.proposed_inr) items.push({ type: 'proposal value change', id, brand: o.brand, detail: `proposed ${p.proposed_inr} → ${o.proposed_inr}`, signed_delta_inr: 0, confirmed_delta: 0 });
  }
  if (a.kpis.target_confirmed !== b.kpis.target_confirmed || a.kpis.target_version !== b.kpis.target_version)
    items.push({ type: 'target change', id: b.kpis.target_version, brand: '', detail: `confirmed-partnership target ${a.kpis.target_confirmed} → ${b.kpis.target_confirmed} (${a.kpis.target_version} → ${b.kpis.target_version}); attainment ${a.kpis.confirmed_vs_target_pct}% → ${b.kpis.confirmed_vs_target_pct}% with no change in deals`, signed_delta_inr: 0, confirmed_delta: 0 });
  const keys = ['recorded_events', 'replied_brands', 'brands_with_held_meeting', 'opportunities', 'current_confirmed', 'ever_confirmed', 'signed_value_inr', 'open_proposals', 'open_proposal_value_inr', 'lost', 'qualified_brands_now', 'confirmed_vs_target_pct'];
  return { from: a.kpis.as_of, to: b.kpis.as_of, items, metrics: keys.map(k => ({ metric: k, from: a.kpis[k], to: b.kpis[k], change: (b.kpis[k] ?? 0) - (a.kpis[k] ?? 0) })),
    reconciliation: { signed_value_change_inr: b.kpis.signed_value_inr - a.kpis.signed_value_inr, explained_by_items_inr: sum(items, i => i.signed_delta_inr) } };
}

export function analyse(sheets, dateStr, opts = {}) {
  const a = snapshot(sheets, dateStr, opts.meta || {});
  a.weekly = weekly(sheets, a, dateStr);
  const compareDate = opts.compareDate || addDaysStr(dateStr, -7);
  a.changes = compareSnapshots(snapshot(sheets, compareDate, opts.meta || {}), a);
  a.datasetVersion = opts.datasetVersion || datasetVersion(sheets);
  return a;
}

// ---------- deck plan model (frozen), scenario lab and ordered bridge (₹ lakh) ----------
export const TDS_MULTIPLIER = 0.98; // plan assumption (A/I), applied only to modelled gross amounts, never to already-net receipts
export const SCENARIOS = {
  reference: { label: 'Interview reference scenario (deck: "Today")', top: 23.5, topShare: 0, mid: 44, midShare: 0.55, local: 2.25, localShare: 0.85, stalls: 7.9 },
  base: { label: 'Deck base', top: 23.5, topShare: 0, mid: 44, midShare: 0.65, local: 2.25, localShare: 0.9, stalls: 14.5 },
  aim: { label: 'Deck aim', top: 36, topShare: 0.25, mid: 64, midShare: 0.7, local: 2.25, localShare: 0.9, stalls: 18 },
  aim_no_advance: { label: 'Aim without title advance', top: 36, topShare: 0, mid: 64, midShare: 0.7, local: 2.25, localShare: 0.9, stalls: 18 },
};
export const PRE_FEST_OBLIGATION_L = 100; // ₹1 Cr artists + hospitality (I)
export function cashModel(p) {
  const sponsor = (p.top * p.topShare + p.mid * p.midShare + p.local * p.localShare) * TDS_MULTIPLIER;
  const combined = sponsor + p.stalls;
  return { signed_l: r4(p.top + p.mid + p.local), sponsor_cash_l: r4(sponsor), stalls_l: r4(p.stalls), combined_cash_l: r4(combined),
    other_funding_needed_l: r4(Math.max(0, PRE_FEST_OBLIGATION_L - combined)), formula: `(${p.top}×${p.topShare} + ${p.mid}×${p.midShare} + ${p.local}×${p.localShare}) × ${TDS_MULTIPLIER} + stalls ${p.stalls}` };
}
export function bridge(base = SCENARIOS.base, aim = SCENARIOS.aim) {
  const T = TDS_MULTIPLIER;
  const s0 = cashModel(base).combined_cash_l;
  const tiers = (aim.mid - base.mid) * base.midShare * T + (aim.top - base.top) * base.topShare * T;
  const terms = (aim.mid * (aim.midShare - base.midShare) + aim.top * (aim.topShare - base.topShare) + aim.local * (aim.localShare - base.localShare)) * T;
  const stalls = aim.stalls - base.stalls;
  return { label: 'Ordered scenario bridge (order-dependent; not causal attribution)', steps: [
    { step: 'Deck base combined cash', value_l: r4(s0) },
    { step: 'Bigger tiers: mid-tier pool at base collection share (Bet 4, enabled by Bets 1 and 5)', value_l: r4(tiers) },
    { step: 'Cash terms: mid share and title advance (Bet 3)', value_l: r4(terms) },
    { step: 'Stalls paid at booking (Bet 2)', value_l: r4(stalls) },
    { step: 'Deck aim combined cash', value_l: r4(s0 + tiers + terms + stalls) }],
    check_l: cashModel(aim).combined_cash_l, note: 'Renewal protection (₹37L) and warm sourcing (₹33L new value) enable these values; they are not extra waterfall cash. Barter (₹5.5L) is avoided spend, outside the cash total.' };
}
export const TIER_MIX = {
  base: [['Title', 1, 13], ['Co-title', 1, 10.5], ['Associate', 2, 13], ['Big', 6, 21], ['Event', 2, 10], ['Local', 15, 2.25]],
  aim: [['Title', 1, 15], ['Co-title', 2, 21], ['Associate', 3, 19.5], ['Big', 7, 24.5], ['Event', 4, 20], ['Local', 15, 2.25]],
};
export function dealMix(historicalAvgInr) {
  const tot = m => ({ deals: sum(m, x => x[1]), value_l: r4(sum(m, x => x[2])) });
  const b = tot(TIER_MIX.base), a = tot(TIER_MIX.aim), h = historicalAvgInr / 1e5;
  return { historical_avg_l: r4(h), base: { ...b, avg_l: r4(b.value_l / b.deals), multiple_of_historical: r4(b.value_l / b.deals / h) },
    aim: { ...a, avg_l: r4(a.value_l / a.deals), multiple_of_historical: r4(a.value_l / a.deals / h) },
    message: 'The plan depends on higher-value tiers, not just five more wins.' };
}
export const BETS = [
  { id: 'B1', rank: 1, name: 'Renew past sponsors first', budget_l: 0.3, team: '1 head', by: 'T-60', stake: '₹37L protected sponsor value (not incremental cash)', call: 'Double down', fixes: 'RC1' },
  { id: 'B2', rank: 2, name: 'Stalls paid in full at booking', budget_l: 0.6, team: '1 associate', by: 'T-14', stake: '+₹6.6L accelerated cash vs reference', call: 'Double down', fixes: 'RC4' },
  { id: 'B3', rank: 3, name: 'Cash-terms desk', budget_l: 2.0, team: 'finance lead + 1', by: 'all season', stake: '+₹4.4L accelerated cash (₹8.82L more with title advance)', call: 'Double down', fixes: 'RC3' },
  { id: 'B4', rank: 4, name: 'Goal-based packages + barter', budget_l: 1.5, team: '2 heads', by: 'T-45', stake: '+₹12.7L pre-fest cash via bigger tiers; ₹5.5L avoided spend', call: 'Pilot → scale', fixes: 'RC2' },
  { id: 'B5', rank: 5, name: 'Warm-introduction engine', budget_l: 1.5, team: '2 heads', by: 'T-24', stake: '₹33L new-sponsor value pipeline', call: 'Pilot → scale', fixes: 'RC1' },
];
export const BUDGET = { envelope_l: 6, allocated_l: r4(sum(BETS, b => b.budget_l)), unallocated_l: r4(6 - sum(BETS, b => b.budget_l)), note: 'Deck rounds ₹5.9L to ₹6L; ₹0.1L stays unallocated until a recorded decision.' };

// ---------- rule registry: published thresholds (deck slide 3) + documented interpretation (A) ----------
export const RULES = [
  { bet: 'B1', metric: 'Renewal LOIs signed (count)', published: { stop: '≤6 by T-45', change: '7–10', plan: '11–13 by T-60', scale: '≥14' },
    interpretation: 'Checkpoint T-60: ≥14 scale, 11–13 plan, 7–10 change, ≤6 review (stop applies at T-45). Checkpoint T-45: ≤6 stop, 7–10 change, ≥14 scale, 11–13 review (no published branch).',
    actions: { stop: 'Move 2 heads to the warm-intro engine (show remaining renewal coverage)', change: 'Leadership call to each sponsor; resend last year\'s results', plan: 'Hold course', scale: 'Upsell each renewing sponsor one tier' }, risk: 'Contact has left, or last year\'s delivery fell short' },
  { bet: 'B2', metric: 'Stalls fully paid (cleared receipts ≥ agreed price)', published: { stop: '<10 by T-45', change: '20–29 at T-30', plan: '≥15 by T-45', scale: 'Sold out by T-30' },
    interpretation: 'T-45: <10 stop, ≥15 plan, 10–14 review. T-30: sold out = scale, 20–29 change, other values review. 50/50 split bookings are not fully paid until the balance clears.',
    actions: { stop: 'Cut to 40 stalls', change: 'Offer a 50/50 payment split (not counted as fully paid)', plan: 'Hold course', scale: 'Raise the price 10%' }, risk: 'Vendors wait for footfall proof and book late' },
  { bet: 'B3', metric: 'Pilot gate: first 10 discount offers that cleared their agreed advance; Collection gate: cleared sponsor cash ÷ signed cash-support value', published: { stop: '<2 of first 10', change: '40–49%', plan: '≥50% at T-30', scale: '≥65%' },
    interpretation: 'Two gates shown separately. Pilot: evaluated once 10 offers exist; <2 cleared = stop. Collection (at T-30): ≥65 scale, 50–64.9 plan, 40–49.9 change, <40 review. Denominator: confirmed cash-support contract value in execution scope, excluding in-kind and stalls; receipts net.',
    actions: { stop: 'Drop the pay-early discount', change: 'Branding goes live only after payment (human decision)', plan: 'Hold course', scale: 'Make pay-early the default term' }, risk: 'Big-sponsor purchase orders ignore the discount' },
  { bet: 'B4', metric: 'Top-tier offers on paper (title / co-title at term sheet or signed)', published: { stop: 'None by T-30', change: 'No title by T-45', plan: 'Title + co-title by T-45', scale: 'Second co-title' },
    interpretation: 'From T-45: title + 2 co-titles scale, title + 1 co-title plan, no title change, title without co-title review. At T-30 with none at all: stop. Higher tier takes precedence.',
    actions: { stop: 'Standard price list; push barter', change: 'Split the title into 2 co-titles', plan: 'Hold course', scale: 'Open 2 category exclusives' }, risk: 'No title buyer; the biggest slot stays empty' },
  { bet: 'B5', metric: 'Held warm meetings per complete Mon–Sun IST week (deduplicated)', published: { stop: '<4 for two weeks', change: '4–7', plan: '8–10', scale: '≥12' },
    interpretation: 'Uses the two latest complete weeks. Both <4 = stop; latest 4–7 change, 8–10 plan, ≥12 scale; exactly 11, or one low week, = review. An incomplete current week never counts.',
    actions: { stop: 'Move heads to renewals (show source assignment)', change: 'Alumni + sponsor-circuit call day', plan: 'Hold course', scale: 'Propose a sixth head (capacity decision, not automatic)' }, risk: 'Alumni network too thin to reach decision-makers' },
  { bet: 'FEST', metric: 'Whole-fest cleared cash: sponsor + stall receipts cleared before fest start (₹L)', published: { stop: '<₹22L', change: '₹22–27L', plan: '≥₹27L at T-30', scale: '≥₹35L' },
    interpretation: 'At T-30: <22 stop, 22≤x<27 change, 27≤x<35 plan, ≥35 scale (≥₹27L plan threshold takes precedence at the boundary). Unknown cash = insufficient data, never stop. ₹35L is still below the ₹1 Cr obligation: extras need a human cash review. Whole-fest scope ignores filters.',
    actions: { stop: 'Downsize the artist line-up (human decision)', change: 'Cut one cost notch', plan: 'Hold course', scale: 'Release Bucket 3 extras after human cash review' }, risk: 'A sponsor quits after signing, or dues slip' },
];

// ---------- execution mode: operational records for the five bets ----------
const TIER_TOP = ['title', 'co_title'];
export function execAnalyse(records, settings, asOf) {
  const fest = settings.fest_date; // YYYY-MM-DD, fest starts this day 00:00 IST
  const festStart = fest + 'T00:00:00';
  const cut = cutoffFor(asOf);
  const T = daysBetween(asOf + 'T00:00:00', festStart);
  const of = k => records.filter(r => r.kind === k).map(r => ({ id: r.id, ...r.data }));
  const norm = d => { const x = String(d); return x.length === 10 ? x + 'T00:00:00' : x; }; // date-only values mean that local day
  const known = (d, upTo = cut) => d != null && d !== '' && norm(d) < upTo;
  const offers = of('offer'), installments = of('installment'), receipts = of('receipt'), renewals = of('renewal'), stalls = of('stall'), intros = of('intro');
  const capacity = Number(settings.stall_capacity || 60);

  const receiptOk = (r, upTo) => r.status === 'cleared' && known(r.cleared_date, upTo) && norm(r.cleared_date) < festStart && !r.reversed;
  const clearedSum = (filter, upTo = cut) => sum(receipts.filter(r => receiptOk(r, upTo) && filter(r)), r => r.amount_inr);
  const contractsAt = upTo => offers.filter(o => o.status === 'signed' && known(o.signed_date, upTo));
  const signedNow = contractsAt(cut);
  const signedCash = signedNow.filter(o => o.support === 'cash');

  // cash calendar
  const inst = installments.map(i => {
    const paid = sum(receipts.filter(r => r.installment_id === i.id && receiptOk(r, cut)), r => r.amount_inr);
    const o = offers.find(x => x.id === i.offer_id) || {};
    const remaining = Math.max(0, Number(i.amount_inr) - paid);
    return { ...i, sponsor: o.sponsor, contract_status: o.status, paid_inr: paid, remaining_inr: remaining,
      bucket: o.status === 'withdrawn' ? 'cancelled' : remaining === 0 ? 'cleared' : String(i.due_date) >= fest ? 'due after fest' : String(i.due_date) < asOf ? 'overdue' : 'due before fest' };
  });
  const unscheduled = signedCash.filter(o => !installments.some(i => i.offer_id === o.id)).map(o => ({ offer_id: o.id, sponsor: o.sponsor, value_inr: o.value_inr }));
  const sponsorCleared = clearedSum(r => r.category === 'sponsor');
  const stallCleared = clearedSum(r => r.category === 'stall');
  const hasReceipts = receipts.length > 0;

  const stallPaid = upTo => stalls.filter(s => s.status !== 'cancelled' && known(s.booking_date, upTo) && clearedSum(r => r.stall_id === s.id, upTo) >= Number(s.price_inr)).length;
  const loisAt = upTo => renewals.filter(r => r.loi_status === 'signed' && known(r.loi_date, upTo)).length;
  const topAt = upTo => { const t = offers.filter(o => TIER_TOP.includes(o.tier) && ['term_sheet', 'signed'].includes(o.status) && known(o.offer_date, upTo));
    return { title: t.filter(o => o.tier === 'title').length, co_title: t.filter(o => o.tier === 'co_title').length, ids: t.map(o => o.id) }; };
  const weeksOfMeetings = () => {
    const seen = new Set(); const meets = [];
    intros.forEach(x => { if (x.meeting_held_date && known(x.meeting_held_date)) { const k = `${x.brand}|${day(x.meeting_held_date)}`; if (!seen.has(k)) { seen.add(k); meets.push(day(x.meeting_held_date)); } } });
    const d0 = new Date(asOf + 'T12:00:00Z'); const dow = (d0.getUTCDay() + 6) % 7; // Monday=0
    const thisMon = addDaysStr(asOf, -dow); const w1s = addDaysStr(thisMon, -7), w0s = addDaysStr(thisMon, -14);
    const cnt = s => meets.filter(m => m >= s && m <= addDaysStr(s, 6)).length;
    return { latest_complete_week: { start: w1s, meetings: cnt(w1s) }, previous_complete_week: { start: w0s, meetings: cnt(w0s) }, current_incomplete_week: { start: thisMon, meetings: cnt(thisMon) }, any: meets.length };
  };
  const at = n => addDaysStr(fest, -n);
  const cutAt = n => cutoffFor(at(n));
  const rule = id => RULES.find(r => r.bet === id);
  const out = (id, o) => ({ bet: id, ...o, rule_version: RULE_VERSION, published: rule(id).published, interpretation: rule(id).interpretation, action: o.call && rule(id).actions[o.call] ? rule(id).actions[o.call] : o.action || 'No automatic action', risk: rule(id).risk });

  const evals = [];
  { // B1
    const now = loisAt(cut); let call, state, value = now, window = `as of ${asOf}`;
    if (!renewals.length) state = 'insufficient data';
    else if (T > 60) state = 'not due';
    else if (T > 45) { value = loisAt(cutAt(60)); window = `T-60 checkpoint (${at(60)})`; call = value >= 14 ? 'scale' : value >= 11 ? 'plan' : value >= 7 ? 'change' : null; state = call ? 'evaluated' : 'review'; }
    else { value = loisAt(cutAt(45)); window = `T-45 checkpoint (${at(45)})`; call = value <= 6 ? 'stop' : value <= 10 ? 'change' : value >= 14 ? 'scale' : null; state = call ? 'evaluated' : 'review'; }
    evals.push(out('B1', { metric: rule('B1').metric, value, unit: 'LOIs', window, call: call || null, state, progress: `${now} LOIs signed of ${renewals.length} eligible past sponsors`, evidence: renewals.filter(r => r.loi_status === 'signed').map(r => r.id) }));
  }
  { // B2
    let call, state, value = stallPaid(cut), window = `as of ${asOf}`;
    if (!stalls.length) state = 'insufficient data';
    else if (T > 45) state = 'not due';
    else if (T > 30) { value = stallPaid(cutAt(45)); window = `T-45 checkpoint (${at(45)})`; call = value < 10 ? 'stop' : value >= 15 ? 'plan' : null; state = call ? 'evaluated' : 'review'; }
    else { value = stallPaid(cutAt(30)); window = `T-30 checkpoint (${at(30)})`; call = value >= capacity ? 'scale' : value >= 20 && value <= 29 ? 'change' : null; state = call ? 'evaluated' : 'review'; }
    evals.push(out('B2', { metric: rule('B2').metric, value, unit: `of ${capacity} stalls`, window, call: call || null, state, progress: `${stallPaid(cut)} fully paid; ${stalls.filter(s => s.status !== 'cancelled').length} booked`, evidence: stalls.map(s => s.id) }));
  }
  { // B3 pilot gate and collection gate
    const pilot = offers.filter(o => o.discount_offered && o.support === 'cash' && known(o.offer_date)).sort((a, b) => String(a.offer_date).localeCompare(String(b.offer_date))).slice(0, 10);
    const clearedAdv = pilot.filter(o => { const adv = Number(o.value_inr) * Number(o.advance_share || 0); return adv > 0 && sum(receipts.filter(r => r.offer_id === o.id && receiptOk(r, cut)), r => r.amount_inr) >= adv; }).length;
    evals.push(out('B3', { gate: 'pilot', metric: 'First 10 discount offers that cleared their agreed advance', value: clearedAdv, unit: `of ${pilot.length} offers`, window: 'first 10 eligible offers', call: pilot.length >= 10 && clearedAdv < 2 ? 'stop' : null,
      state: pilot.length < 10 ? 'not due' : clearedAdv < 2 ? 'evaluated' : 'no stop (pilot passed; collection gate governs)', progress: `${pilot.length}/10 offers made`, evidence: pilot.map(o => o.id) }));
    const denom = sum(signedCash, o => o.value_inr);
    const ratioAt = upTo => { const d = sum(contractsAt(upTo).filter(o => o.support === 'cash'), o => o.value_inr); return d ? Math.round(1000 * clearedSum(r => r.category === 'sponsor', upTo) / d) / 10 : null; };
    let call, state, value = denom ? Math.round(1000 * sponsorCleared / denom) / 10 : null, window = `as of ${asOf}`;
    if (!denom || !hasReceipts) state = 'insufficient data';
    else if (T > 30) state = 'not due';
    else { value = ratioAt(cutAt(30)); window = `T-30 checkpoint (${at(30)})`; call = value == null ? null : value >= 65 ? 'scale' : value >= 50 ? 'plan' : value >= 40 ? 'change' : null; state = call ? 'evaluated' : value == null ? 'insufficient data' : 'review'; }
    evals.push(out('B3', { gate: 'collection', metric: 'Cleared sponsor cash ÷ signed cash-support value', value, unit: '%', window, call: call || null, state, progress: `₹${sponsorCleared.toLocaleString('en-IN')} cleared of ₹${denom.toLocaleString('en-IN')} signed cash-support`, evidence: signedCash.map(o => o.id) }));
  }
  { // B4
    const now = topAt(cut); let call, state, window = `as of ${asOf}`, v = now;
    if (!offers.length) state = 'insufficient data';
    else if (T > 45) state = 'not due';
    else {
      v = T > 30 ? topAt(cutAt(45)) : topAt(cut); window = T > 30 ? `T-45 checkpoint (${at(45)})` : `from T-30 (${at(30)})`;
      call = v.title && v.co_title >= 2 ? 'scale' : v.title && v.co_title >= 1 ? 'plan' : (T <= 30 && !v.title && !v.co_title) ? 'stop' : !v.title ? 'change' : null; state = call ? 'evaluated' : 'review';
    }
    evals.push(out('B4', { metric: rule('B4').metric, value: `${v.title} title, ${v.co_title} co-title`, unit: '', window, call: call || null, state, progress: `${now.title} title + ${now.co_title} co-title on paper`, evidence: now.ids }));
  }
  { // B5
    const w = weeksOfMeetings(); let call = null, state;
    if (!intros.length) state = 'insufficient data';
    else { const a1 = w.latest_complete_week.meetings, a0 = w.previous_complete_week.meetings;
      if (a1 < 4 && a0 < 4) call = 'stop'; else if (a1 >= 12) call = 'scale'; else if (a1 >= 8 && a1 <= 10) call = 'plan'; else if (a1 >= 4 && a1 <= 7) call = 'change';
      state = call ? 'evaluated' : 'review'; }
    evals.push(out('B5', { metric: rule('B5').metric, value: w.latest_complete_week.meetings, unit: 'meetings', window: `complete week from ${w.latest_complete_week.start} (previous: ${w.previous_complete_week.meetings}; current incomplete week: ${w.current_incomplete_week.meetings}, not counted)`, call, state, progress: `${w.any} distinct held warm meetings logged`, evidence: intros.filter(x => x.meeting_held_date).map(x => x.id) }));
  }
  { // FEST gate (whole-fest scope)
    let call = null, state, value = hasReceipts ? Math.round((sponsorCleared + stallCleared) / 1e3) / 100 : null, window = `as of ${asOf}`;
    if (!hasReceipts) state = 'insufficient data';
    else if (T > 30) state = 'not due';
    else { value = Math.round((clearedSum(r => r.category === 'sponsor', cutAt(30)) + clearedSum(r => r.category === 'stall', cutAt(30))) / 1e3) / 100; window = `T-30 checkpoint (${at(30)})`;
      call = value < 22 ? 'stop' : value < 27 ? 'change' : value < 35 ? 'plan' : 'scale'; state = 'evaluated'; }
    evals.push(out('FEST', { metric: rule('FEST').metric, value, unit: '₹L', window, call, state, scope: 'whole fest: ignores dashboard filters', basis: 'Recorded sponsor + stall receipts only; not a bank balance (opening balance and outflows not recorded)',
      progress: hasReceipts ? `₹${((sponsorCleared + stallCleared) / 1e5).toFixed(2)}L cleared so far` : 'no receipts recorded', evidence: receipts.filter(r => r.status === 'cleared').map(r => r.id) }));
  }

  const dueBefore = inst.filter(i => i.bucket === 'due before fest' || i.bucket === 'overdue');
  const kpis = {
    fest_date: fest, as_of: asOf, t_minus_days: T,
    receipts_status: hasReceipts ? 'recorded (simulated/user-entered; completeness not verified)' : 'none recorded',
    sponsor_receipts_cleared_inr: hasReceipts ? sponsorCleared : null, stall_receipts_cleared_inr: hasReceipts ? stallCleared : null,
    combined_receipts_cleared_inr: hasReceipts ? sponsorCleared + stallCleared : null,
    sponsor_vs_base_pct: hasReceipts ? pct(sponsorCleared, 30.0125e5) : null, sponsor_vs_aim_pct: hasReceipts ? pct(sponsorCleared, 54.7085e5) : null,
    combined_vs_base_pct: hasReceipts ? pct(sponsorCleared + stallCleared, 44.5125e5) : null, combined_vs_aim_pct: hasReceipts ? pct(sponsorCleared + stallCleared, 72.7085e5) : null,
    signed_contracts: signedNow.length, signed_value_inr: sum(signedNow, o => o.value_inr), signed_cash_support_inr: sum(signedCash, o => o.value_inr), signed_in_kind_inr: sum(signedNow.filter(o => o.support !== 'cash'), o => o.value_inr),
    due_before_fest_remaining_inr: sum(inst.filter(i => i.bucket === 'due before fest'), i => i.remaining_inr), overdue_inr: sum(inst.filter(i => i.bucket === 'overdue'), i => i.remaining_inr),
    due_after_fest_inr: sum(inst.filter(i => i.bucket === 'due after fest'), i => i.remaining_inr), unscheduled_signed_cash_inr: sum(unscheduled, u => u.value_inr),
    scheduled_pre_fest_outlook_inr: (hasReceipts ? sponsorCleared + stallCleared : 0) + sum(dueBefore, i => i.remaining_inr),
    pre_fest_obligation_inr: PRE_FEST_OBLIGATION_L * 1e5, other_funding_needed_inr: Math.max(0, PRE_FEST_OBLIGATION_L * 1e5 - (hasReceipts ? sponsorCleared + stallCleared : 0) - sum(dueBefore, i => i.remaining_inr)),
    stalls_fully_paid: stallPaid(cut), stall_capacity: capacity, renewal_lois_signed: loisAt(cut), renewals_eligible: renewals.length,
  };
  return { kpis, rules: evals, installments: inst, unscheduled, offers, receipts, renewals, stalls, intros };
}

// Deterministic simulated execution demo (all records carry sim:true)
export function demoExecutionRecords(fest = '2027-02-26') {
  const d = n => addDaysStr(fest, -n);
  const R = [];
  const push = (kind, id, data) => R.push({ id, kind, data: { ...data, sim: true } });
  const sponsors = ['Brewcraft Foods', 'PayNest', 'GlowLab Beauty', 'UrbanThread', 'SnackRoute', 'Zipline Mobility', 'Kettle & Co', 'NovaBank', 'Pixel Learning', 'Fresh Crate', 'StreetSole', 'Aqua Pure', 'Campus Eats', 'Bright Minds'];
  sponsors.forEach((s, i) => push('renewal', `ren-${i + 1}`, { sponsor: s, owner: ['Riya Kapoor', 'Nisha Rao', 'Meera Iyer'][i % 3], report_sent_date: d(80 - i), decision_maker_verified: i % 4 !== 3, loi_status: i < 11 ? 'signed' : 'sent', loi_date: i < 11 ? d(72 - i * 2) : null, value_inr: 250000 + (i % 5) * 50000, at: d(80 - i) }));
  push('offer', 'off-title', { sponsor: 'NovaBank', tier: 'title', value_inr: 1500000, support: 'cash', status: 'signed', offer_date: d(58), signed_date: d(50), advance_share: 0.25, discount_offered: false, bet: 'B4', category: 'banking' });
  push('offer', 'off-co1', { sponsor: 'PayNest', tier: 'co_title', value_inr: 1050000, support: 'cash', status: 'signed', offer_date: d(56), signed_date: d(47), advance_share: 0, discount_offered: true, bet: 'B4', category: 'fintech' });
  push('offer', 'off-co2', { sponsor: 'GlowLab Beauty', tier: 'co_title', value_inr: 1050000, support: 'cash', status: 'term_sheet', offer_date: d(40), signed_date: null, advance_share: 0, discount_offered: false, bet: 'B4', category: 'beauty' });
  const mids = [['Brewcraft Foods', 'associate', 650000], ['UrbanThread', 'associate', 650000], ['SnackRoute', 'big', 350000], ['Zipline Mobility', 'big', 350000], ['Kettle & Co', 'big', 350000], ['Pixel Learning', 'event', 500000], ['Fresh Crate', 'big', 350000], ['StreetSole', 'big', 350000], ['Aqua Pure', 'event', 500000], ['Campus Eats', 'big', 350000]];
  mids.forEach(([s, t, v], i) => push('offer', `off-m${i + 1}`, { sponsor: s, tier: t, value_inr: v, support: i === 9 ? 'in_kind' : 'cash', status: i < 8 ? 'signed' : 'term_sheet', offer_date: d(70 - i * 3), signed_date: i < 8 ? d(60 - i * 3) : null, advance_share: 0.65, discount_offered: true, bet: 'B3', category: t }));
  // installments: title 25% advance before fest, balance after; mid-size 65% before, 35% after
  push('installment', 'ins-title-a', { offer_id: 'off-title', due_date: d(35), amount_inr: 375000 });
  push('installment', 'ins-title-b', { offer_id: 'off-title', due_date: addDaysStr(fest, 20), amount_inr: 1125000 });
  push('installment', 'ins-co1', { offer_id: 'off-co1', due_date: addDaysStr(fest, 25), amount_inr: 1050000 });
  mids.slice(0, 8).forEach(([s, t, v], i) => { push('installment', `ins-m${i + 1}-a`, { offer_id: `off-m${i + 1}`, due_date: d(50 - i * 3), amount_inr: Math.round(v * 0.65) }); push('installment', `ins-m${i + 1}-b`, { offer_id: `off-m${i + 1}`, due_date: addDaysStr(fest, 15), amount_inr: Math.round(v * 0.35) }); });
  // receipts: title advance cleared; mid advances mostly cleared
  push('receipt', 'rcp-title-a', { category: 'sponsor', offer_id: 'off-title', installment_id: 'ins-title-a', amount_inr: 375000, cleared_date: d(33), status: 'cleared', net: true });
  mids.slice(0, 8).forEach(([s, t, v], i) => { if (i !== 3 && i !== 6) push('receipt', `rcp-m${i + 1}`, { category: 'sponsor', offer_id: `off-m${i + 1}`, installment_id: `ins-m${i + 1}-a`, amount_inr: Math.round(v * 0.65), cleared_date: d(46 - i * 3), status: i === 7 ? 'pending' : 'cleared', net: true }); });
  // stalls: 60 capacity, ₹25k each; 22 fully paid by T-30
  for (let i = 1; i <= 30; i++) {
    push('stall', `stall-${i}`, { vendor: `Vendor ${i}`, category: ['food', 'merch', 'games', 'services'][i % 4], price_inr: 25000, booking_date: d(60 - i), status: 'booked', payment_plan: i <= 24 ? 'full' : '50/50' });
    if (i <= 22) push('receipt', `rcp-stall-${i}`, { category: 'stall', stall_id: `stall-${i}`, amount_inr: 25000, cleared_date: d(58 - i), status: 'cleared', net: true });
    else if (i > 24) push('receipt', `rcp-stall-${i}`, { category: 'stall', stall_id: `stall-${i}`, amount_inr: 12500, cleared_date: d(55 - i), status: 'cleared', net: true });
  }
  // warm intros: meetings across weeks
  const meetDays = [70, 68, 66, 63, 61, 59, 57, 56, 54, 52, 50, 49, 47, 45, 44, 43, 41, 40, 38, 37, 36, 34, 33, 31, 30, 29, 28];
  meetDays.forEach((n, i) => push('intro', `intro-${i + 1}`, { brand: `Warm Prospect ${i + 1}`, introducer: ['Alumni network', 'Sponsor circuit', 'Creator referral'][i % 3], requested_date: d(n + 7), accepted_date: d(n + 4), meeting_held_date: d(n), decision_maker: i % 3 !== 2, qualified: i % 2 === 0 }));
  return R;
}

// ---------- snapshot identity and AI snapshot ----------
export function snapshotId({ workspace = 'ws', dataset = 'ds', overlayRevision = 0, asOf, mode, plan = PLAN_VERSION, rules = RULE_VERSION, filters = '' }) {
  return 'snap-' + hash([workspace, dataset, overlayRevision, asOf, mode, plan, rules, filters].join('|'));
}
export function snapshotForAI(a, ctx = {}) {
  const { tasks = [], exec = null, mode = 'historical', snapshot_id, records = [] } = ctx;
  const tables = {
    opportunities: a.oppRows.map(o => ({ ...o })),
    campaigns: a.byCampaign,
    brand_funnel: a.brandFunnel, opportunity_funnel: a.oppFunnel, deck_funnel: a.deckFunnel,
    industries: a.byIndustry, owners: a.owners,
    interactions: a.events.map(e => ({ interaction_id: e.interaction_id, date: day(e.occurred_at), brand: e.brand_name, brand_id: e.brand_id, campaign: e.campaign_name, channel: e.channel, event_type: e.event_type, outcome: e.outcome, note_untrusted: e.summary })),
    stage_history: a.hist.map(h => ({ history_id: h.history_id, opportunity_id: h.opportunity_id, brand: h.brand_name, stage: h.stage, proposed_inr: h.proposed_value_inr, confirmed_inr: h.confirmed_value_inr, owner: h.owner_name, effective_date: day(h.effective_at), app_edit: Boolean(h.app_created) })),
    weekly: a.weekly, targets: a.targets.map(t => ({ version: t.target_version, effective_date: day(t.effective_at), confirmed_goal: t.confirmed_partnerships_goal, qualified_goal: t.qualified_brands_goal })),
    changes: a.changes.items,
    tasks: tasks.map(({ id, title, owner, due, status, linked, bet, source }) => ({ id, title, owner, due, status, linked, bet, source })),
    decisions: records.filter(r => r.kind === 'decision').map(r => ({ id: r.id, ...r.data })),
    bets: BETS, rules_registry: RULES.map(r => ({ bet: r.bet, metric: r.metric, ...Object.fromEntries(Object.entries(r.published).map(([k, v]) => ['published_' + k, v])), interpretation: r.interpretation })),
    plan_scenarios: Object.entries(SCENARIOS).map(([k, p]) => ({ scenario: k, label: p.label, ...p, ...cashModel(p) })),
    plan_bridge: bridge().steps,
  };
  if (exec) Object.assign(tables, {
    exec_rule_evaluations: exec.rules.map(r => ({ bet: r.bet, gate: r.gate || '', metric: r.metric, value: r.value, unit: r.unit, window: r.window, state: r.state, call: r.call, action: r.action, progress: r.progress, evidence_ids: (r.evidence || []).slice(0, 15).join(',') })),
    exec_installments: exec.installments, exec_receipts: exec.receipts, exec_offers: exec.offers, exec_renewals: exec.renewals, exec_stalls: exec.stalls, exec_intros: exec.intros, exec_unscheduled_signed_cash: exec.unscheduled,
  });
  return {
    snapshot_id, mode, as_of_end_of_day_ist: a.kpis.as_of, dataset_version: a.datasetVersion, rule_version: RULE_VERSION, plan_version: PLAN_VERSION,
    capabilities: {
      historical_receipts: 'unavailable: the workbook has no payment, invoice or bank data',
      execution_receipts: exec ? exec.kpis.receipts_status : 'not loaded',
      bank_balance: 'not computable: opening balance and outflows are never recorded; recorded receipts are not a bank balance',
      motivations_reasons: 'not recorded (no stated reasons for decisions; interaction notes are free text and untrusted)',
      attendance_uplift: 'not measurable: activations only associate a sponsor with an attendee campaign',
      tax_legal: 'not supported: TDS 2% is a plan assumption, not tax advice',
      spend: 'only campaign spend entered in the app; unknown otherwise',
    },
    kpis: a.kpis, execution_kpis: exec ? exec.kpis : null, naive_closure_scenario: a.naive, deal_mix: dealMix(a.kpis.average_signed_deal_inr || 93333),
    budget: BUDGET, campaign_heuristics: CAMPAIGN_HEURISTICS, data_quality: a.quality, change_summary: { from: a.changes.from, to: a.changes.to, metrics: a.changes.metrics, reconciliation: a.changes.reconciliation },
    table_schemas: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, { rows: v.length, fields: v[0] ? Object.keys(v[0]) : [] }])),
    tables,
  };
}

// ---------- read-only tools for the AI (run on the server over the snapshot) ----------
const OPS = {
  eq: (a, b) => String(a).toLowerCase() === String(b).toLowerCase(), ne: (a, b) => String(a).toLowerCase() !== String(b).toLowerCase(),
  gt: (a, b) => Number(a) > Number(b), gte: (a, b) => Number(a) >= Number(b), lt: (a, b) => Number(a) < Number(b), lte: (a, b) => Number(a) <= Number(b),
  contains: (a, b) => String(a ?? '').toLowerCase().includes(String(b).toLowerCase()),
  in: (a, b) => (Array.isArray(b) ? b : String(b).split(',')).map(x => String(x).trim().toLowerCase()).includes(String(a).toLowerCase()),
  is_null: a => a == null, not_null: a => a != null,
};
export function runQuery(snapshot, q = {}) {
  const t = snapshot.tables?.[q.table];
  if (!t) return { error: `Unknown table "${q.table}"`, supported_tables: Object.keys(snapshot.tables || {}) };
  const fields = t[0] ? Object.keys(t[0]) : [];
  for (const w of q.where || []) {
    if (!OPS[w.op]) return { error: `Unknown operator ${w.op}`, supported_operators: Object.keys(OPS) };
    if (t[0] && !fields.includes(w.field)) return { error: `Unknown field "${w.field}" in ${q.table}`, supported_fields: fields };
  }
  for (const f of [q.group_by, q.sort_by, ...(q.aggregates || []).map(a => a.field)].filter(Boolean))
    if (t[0] && !fields.includes(f)) return { error: `Unknown field "${f}" in ${q.table}`, supported_fields: fields };
  let rows = t.filter(r => (q.where || []).every(w => OPS[w.op](r[w.field], w.value)));
  const aggs = q.aggregates && q.aggregates.length ? q.aggregates : null;
  const doAgg = (rs, ag) => {
    const vals = rs.map(r => r[ag.field]).filter(v => v != null && v !== '');
    const nums = vals.map(Number).filter(v => !Number.isNaN(v));
    switch (ag.op) {
      case 'count': return rs.length;
      case 'count_distinct': return new Set(vals.map(String)).size;
      case 'sum': return nums.reduce((s, v) => s + v, 0);
      case 'avg': return nums.length ? Math.round(1e4 * nums.reduce((s, v) => s + v, 0) / nums.length) / 1e4 : null;
      case 'min': return nums.length ? Math.min(...nums) : null;
      case 'max': return nums.length ? Math.max(...nums) : null;
      default: return { error: `unknown aggregate ${ag.op}` };
    }
  };
  const nulls = ag => ag.field ? rows.filter(r => r[ag.field] == null).length : 0;
  const prov = { table: q.table, scope: { snapshot_id: snapshot.snapshot_id, as_of: snapshot.as_of_end_of_day_ist, mode: snapshot.mode }, filters: q.where || [], matched_rows: rows.length };
  if (q.group_by) {
    const g = new Map(); rows.forEach(r => { const k = r[q.group_by] ?? '(null)'; if (!g.has(k)) g.set(k, []); g.get(k).push(r); });
    const list = [...g.entries()].map(([k, rs]) => ({ [q.group_by]: k, rows: rs.length, ...Object.fromEntries((aggs || [{ op: 'count', as: 'count' }]).map(ag => [ag.as || `${ag.op}_${ag.field || 'rows'}`, doAgg(rs, ag)])) }));
    const key = (aggs && (aggs[0].as || `${aggs[0].op}_${aggs[0].field || 'rows'}`)) || 'count';
    list.sort((x, y) => (Number(y[key]) || 0) - (Number(x[key]) || 0));
    const lim = Math.min(q.limit || 50, 100);
    return { ...prov, group_by: q.group_by, groups: list.slice(0, lim), truncated: list.length > lim };
  }
  if (aggs) return { ...prov, results: Object.fromEntries(aggs.map(ag => [ag.as || `${ag.op}_${ag.field || 'rows'}`, doAgg(rows, ag)])), null_counts: Object.fromEntries(aggs.filter(a => a.field).map(a => [a.field, nulls(a)])) };
  if (q.sort_by) rows = [...rows].sort((x, y) => { const a = x[q.sort_by], b = y[q.sort_by]; const c = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)); return q.desc ? -c : c; });
  const lim = Math.min(q.limit || 25, 60);
  const pick = q.fields && q.fields.length ? rows.map(r => Object.fromEntries(q.fields.filter(f => f in r).map(f => [f, r[f]]))) : rows;
  return { ...prov, rows: pick.slice(0, lim), returned_rows: Math.min(lim, pick.length), truncated: pick.length > lim, note: pick.length > lim ? 'Rows truncated: use aggregates for totals, never sum the returned subset.' : undefined };
}
// Arithmetic only (bounded recursive-descent parser; no eval). Division by zero → undefined.
export function calculate(expr) {
  const s = String(expr || '').replace(/,/g, '').replace(/₹/g, '');
  if (s.length > 300) return { error: 'Expression too long' };
  if (!/^[\d\s+\-*/%().]+$/.test(s)) return { error: 'Only numbers and + - * / % ( ) are allowed' };
  let i = 0; let divZero = false;
  const skip = () => { while (s[i] === ' ') i++; };
  const num = () => { skip(); if (s[i] === '(') { i++; const v = add(); skip(); if (s[i] !== ')') throw new Error('missing )'); i++; return v; }
    if (s[i] === '-') { i++; return -num(); } const j = i; while (/[\d.]/.test(s[i] || '')) i++; if (i === j) throw new Error('number expected'); return parseFloat(s.slice(j, i)); };
  const mul = () => { let v = num(); for (;;) { skip(); const c = s[i]; if (c === '*' || c === '/' || c === '%') { i++; const r = num(); if ((c === '/' || c === '%') && r === 0) divZero = true; v = c === '*' ? v * r : c === '/' ? v / r : v % r; } else return v; } };
  const add = () => { let v = mul(); for (;;) { skip(); const c = s[i]; if (c === '+' || c === '-') { i++; const r = mul(); v = c === '+' ? v + r : v - r; } else return v; } };
  try { const v = add(); skip(); if (i < s.length) throw new Error('unexpected ' + s[i]);
    if (divZero) return { expression: expr, result: null, note: 'undefined: division by zero' };
    return { expression: expr, result: Math.round(v * 1e6) / 1e6 }; }
  catch (e) { return { error: e.message }; }
}

// Monday decision brief (markdown) from deterministic state
export function decisionBrief({ a, exec, tasks = [], decisions = [], snapshot_id, mode }) {
  const L = [];
  L.push(`# Monday decision brief`, `Snapshot ${snapshot_id} · mode ${mode} · as of ${a.kpis.as_of} (end of day IST) · dataset ${a.datasetVersion} · rules ${RULE_VERSION}`, '');
  L.push('## Historical evidence (D)', `- Currently confirmed ${a.kpis.current_confirmed} (ever ${a.kpis.ever_confirmed}) vs target ${a.kpis.confirmed_vs_target ?? 'n/a'}; signed ₹${a.kpis.signed_value_inr.toLocaleString('en-IN')} (cash-support ₹${a.kpis.signed_cash_support_inr.toLocaleString('en-IN')}, in-kind ₹${a.kpis.signed_in_kind_inr.toLocaleString('en-IN')}).`,
    `- Receipts: ${a.kpis.receipts_status}. Open proposals ${a.kpis.open_proposals} worth ₹${a.kpis.open_proposal_value_inr.toLocaleString('en-IN')}.`, `- Cold outbound recorded activity ${a.kpis.cold_outbound_activity_share_pct}% with ${a.kpis.cold_outbound_current_wins} current wins (activity proxy, not hours).`, '');
  if (exec) {
    L.push('## Execution (SIM/U)', `- T-${exec.kpis.t_minus_days}; combined cleared receipts ${exec.kpis.combined_receipts_cleared_inr == null ? 'none recorded' : '₹' + exec.kpis.combined_receipts_cleared_inr.toLocaleString('en-IN')}; due before fest ₹${exec.kpis.due_before_fest_remaining_inr.toLocaleString('en-IN')}; overdue ₹${exec.kpis.overdue_inr.toLocaleString('en-IN')}; unscheduled signed cash ₹${exec.kpis.unscheduled_signed_cash_inr.toLocaleString('en-IN')}.`, '', '| Bet | Metric | Value | Window | State | Call | Action |', '|---|---|---|---|---|---|---|');
    exec.rules.forEach(r => L.push(`| ${r.bet}${r.gate ? ' (' + r.gate + ')' : ''} | ${r.metric} | ${r.value ?? '—'} ${r.unit || ''} | ${r.window} | ${r.state} | ${r.call || '—'} | ${r.call ? r.action : '—'} |`));
    L.push('');
  }
  L.push('## Decisions recorded', ...(decisions.length ? decisions.map(d => `- ${d.bet} · ${d.week}: rule ${d.rule_call || '—'} → ${d.choice}${d.rationale ? ` (${d.rationale})` : ''}`) : ['- none']), '');
  L.push('## Open tasks', ...(tasks.filter(t => t.status !== 'done').map(t => `- ${t.title} · ${t.owner || 'unassigned'} · due ${t.due || '—'}${t.linked ? ' · ' + t.linked : ''}`)), '');
  L.push('Evidence classes: D dataset · I interviews · A assumption · U user entry · SIM simulated. Recorded receipts are not a bank balance.');
  return L.join('\n');
}
