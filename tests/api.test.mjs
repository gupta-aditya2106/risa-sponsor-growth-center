import assert from 'assert';
import fs from 'fs';
import chat, { parseModelJson } from '../api/chat.js';
import store from '../api/store.js';
import { analyse, snapshotForAI } from '../engine.js';
const res = resolve => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(o) { resolve({ code: this.statusCode, ...o }); } });
const call = body => new Promise(r => chat({ method: 'POST', body }, res(r)));
let n = 0; const ok = m => { n++; console.log('ok -', m); };

const sheets = JSON.parse(fs.readFileSync(new URL('../data/dataset.json', import.meta.url))).sheets;
const full = snapshotForAI(analyse(sheets, '2025-04-20'), { mode: 'historical', snapshot_id: 'snap-api' });

let r = await call({ question: '', snapshot: full }); assert.equal(r.code, 400); ok('empty question rejected');
delete process.env.GEMINI_API_KEY;
r = await call({ question: 'How much cash have we received?', snapshot: full }); assert.equal(r.code, 503); ok('clear message when key missing (no blanket refusal path)');
assert.equal(parseModelJson('{"answerable": false, "answer": "x"}').answerable, 'no'); ok('legacy boolean answerable normalised');

// mocked Gemini: payment question is sent to the model (not refused by regex) and tools run server-side
process.env.GEMINI_API_KEY = 'test-key';
let turn = 0; const seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body); seen.push(body); turn++;
  const parts = turn === 1 ? [{ functionCall: { name: 'query_table', args: { table: 'opportunities', where: [{ field: 'stage', op: 'in', value: 'proposal_sent,negotiating' }], aggregates: [{ op: 'sum', field: 'proposed_inr', as: 'open' }] } } }]
    : turn === 2 ? [{ functionCall: { name: 'calculate', args: { expression: '1050000 * 0.75' } } }]
    : [{ text: '{"answerable":"partly","answer":"Receipts are unavailable in the workbook; ₹20,00,000 cash-support is signed.","evidence":["kpis.signed_cash_support_inr"],"calculation":"1050000 × 0.75 = 787500","interpretation":"x","missing":"receipt records","next_action":"Record receipts","scope":{"entity_type":"opportunity","ids":["O053"]},"suggested_tasks":[{"title":"Escalate O053","owner":"Meera Iyer","linked":"O053","due_days":2}]}' }];
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts } }] }) };
};
r = await call({ question: 'How much cash have we received?', snapshot: full, history: [{ role: 'user', text: 'Hi' }, { role: 'assistant', text: 'Hello' }], scope: { entity_type: 'campaign', ids: ['SC02'] } });
assert.equal(r.answerable, 'partly'); assert.equal(r.steps.length, 2); assert.equal(r.snapshot_id, 'snap-api'); ok('payment question answered via model, not refused; snapshot id returned');
assert.match(r.steps[0].result_preview, /1050000/); assert.match(r.steps[1].result_preview, /787500/); ok('tool loop: aggregate + exact calculation');
assert.equal(r.suggested_tasks[0].linked, 'O053'); assert.equal(r.scope.ids[0], 'O053'); ok('structured answer with draft tasks and scope');
assert.ok(!JSON.stringify(seen[0].contents[0]).includes('"interactions":[{')); ok('raw tables stay server-side');
assert.ok(seen[0].contents.some(c => c.parts?.[0]?.text === 'Hello')); assert.ok(JSON.stringify(seen[0].contents).includes('SC02')); ok('history and entity scope sent for follow-ups');

// store: auth required, RPC routing
const sres = () => new Promise(resolve => resolve);
const scall = req => new Promise(rs => store(req, res(rs)));
r = await scall({ method: 'GET', headers: {} }); assert.equal(r.code, 400); ok('store rejects missing workspace credentials');
const rpcCalls = [];
globalThis.fetch = async (url, opts) => { rpcCalls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200, text: async () => JSON.stringify(url.endsWith('gc_put') ? [{ rec_id: 'a', rec_revision: 2 }] : []) }; };
const hdr = { 'x-workspace-id': '11111111-2222-4333-8444-555555555555', 'x-workspace-token': 'x'.repeat(40) };
r = await scall({ method: 'POST', headers: hdr, body: [{ id: 'a', kind: 'task', data: { title: 't' } }, { id: 'b', kind: 'bogus', data: {} }] });
assert.equal(r.saved.length, 1); assert.ok(rpcCalls[0].url.endsWith('/rpc/gc_put')); assert.equal(rpcCalls[0].body.p_ws, hdr['x-workspace-id']); ok('store writes through gc_put with workspace + token, rejects unknown kinds');
r = await scall({ method: 'POST', headers: hdr, body: { action: 'reset' } }); assert.ok(rpcCalls.at(-1).url.endsWith('/rpc/gc_reset')); ok('reset routes to gc_reset');
globalThis.fetch = realFetch;
console.log(`\n${n} api checks passed`);
