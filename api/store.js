// Workspace storage for user-entered records (tasks, receipts, decisions, execution records, edits).
// Each browser holds a random workspace ID and a secret token. Supabase stores only a SHA-256 hash
// of the token; every read and write goes through SECURITY DEFINER functions (gc_list / gc_put /
// gc_delete / gc_reset) that check the pair, so one workspace can never read another's rows and the
// anon role has no direct table access. The publishable key is public by design.
// Override SUPABASE_URL / SUPABASE_ANON_KEY when forking.
const URL_ = process.env.SUPABASE_URL || 'https://jtrlanysmkwuqnntcgxx.supabase.co';
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_PiMjTibR-5iOwaIjQrBFbg_wLfpb9oX';
export const KINDS = ['task', 'receipt', 'installment', 'opp_update', 'opp_new', 'interaction', 'campaign', 'campaign_meta', 'renewal', 'stall', 'offer', 'intro', 'decision', 'scenario', 'signal', 'setting'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rpc(fn, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const text = await r.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) throw Object.assign(new Error(typeof body === 'object' ? body.message || JSON.stringify(body) : body), { status: r.status });
  return body;
}

export default async function handler(req, res) {
  const ws = String(req.headers?.['x-workspace-id'] || req.query?.ws || '');
  const token = String(req.headers?.['x-workspace-token'] || '');
  if (!UUID.test(ws) || token.length < 24) return res.status(400).json({ error: 'workspace id (uuid) and token (≥24 chars) required' });
  const auth = { p_ws: ws, p_token: token };
  try {
    if (req.method === 'GET') {
      const rows = await rpc('gc_list', auth);
      return res.status(200).json({ configured: true, rows });
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.action === 'reset') { await rpc('gc_reset', auth); return res.status(200).json({ ok: true, reset: true }); }
      const rows = (Array.isArray(body) ? body : [body]).filter(x => x && x.id && KINDS.includes(x.kind));
      if (!rows.length) return res.status(400).json({ error: 'id and a valid kind required' });
      if (rows.length > 200) return res.status(413).json({ error: 'max 200 records per call' });
      const saved = [];
      for (const { id, kind, data } of rows) {
        const out = await rpc('gc_put', { ...auth, p_id: String(id).slice(0, 80), p_kind: kind, p_data: data || {} });
        const r0 = Array.isArray(out) ? out[0] : out;
        saved.push({ id: r0?.rec_id ?? id, revision: r0?.rec_revision ?? null });
      }
      return res.status(200).json({ ok: true, saved });
    }
    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '');
      if (!id) return res.status(400).json({ error: 'id required' });
      await rpc('gc_delete', { ...auth, p_id: id });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    const status = e.status === 401 || /token|denied|auth/i.test(e.message) ? 403 : 502;
    return res.status(status).json({ configured: status !== 502, error: e.message });
  }
}
