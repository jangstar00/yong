// /pages/api/character.js  (Next.js Pages Router 기준)
// App Router 쓰면 /app/api/character/route.js 로 형태만 바꾸면 됨.
export const config = { runtime: 'nodejs' };

/* ===== CORS & 공통 ===== */
const CORS = {
  'Access-Control-Allow-Origin': '*', // 필요하면 https://jangstar00.github.io 로 바꿔
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
  'Cache-Control': 'no-store'
};

const UA = 'lostamen-bridge/2.1';
const BASE = 'https://developer-lostark.game.onstove.com/armories/characters';

const okJson = (res, code, body) => { res.writeHead(code, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ===== 안전 fetch(본문 스니펫 포함) ===== */
async function hit(url, token, label, retries = 1) {
  let last = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': UA }
      });
      const text = await r.text();
      if (!r.ok) return { ok:false, which:label, status:r.status, body:text.slice(0,500) };
      try { return { ok:true, which:label, json: JSON.parse(text) }; }
      catch { return { ok:true, which:label, json: {} }; }
    } catch (e) {
      last = String(e && e.message || e);
      await sleep(300);
    }
  }
  return { ok:false, which:label, status:0, body:last || 'fetch failed' };
}

/* ===== 파서 유틸 ===== */
const pickIlv = p =>
  p?.ItemAvgLevel || p?.ItemMaxLevel || p?.ItemLevel ||
  p?.['Item Avg Level'] || p?.['Item Max Level'] || p?.['Item Level'] || '-';

function pickCombatPowerFromStats(profile) {
  const stats = Array.isArray(profile?.Stats) ? profile.Stats : [];
  const hit = stats.find(s => /전투력|combat/i.test(String(s?.Type || s?.Name || '')));
  if (!hit) return null;
  const raw = hit.Value ?? hit.value ?? null;
  if (raw == null) return null;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function mapEquip(e){
  return {
    Type: e?.Type || e?.Slot || '',
    Name: e?.Name || '',
    Grade: e?.Grade || '',
    Icon: e?.Icon || '',
    Quality: typeof e?.Quality === 'number' ? e.Quality : null,
    Tooltip: e?.Tooltip || ''
  };
}

function mapEngraves(obj){
  const arr = obj?.Engravings || obj || [];
  return Array.isArray(arr)
    ? arr.map(e => ({
        Name: e?.Name || '',
        Level: e?.Level || null,
        Icon: e?.Icon || ''
      }))
    : [];
}

function summarizeGems(ge){
  if (!ge || !Array.isArray(ge.Gems)) return null;
  const lv = ge.Gems.map(g => g.Level || 0);
  const avg = lv.length ? Number((lv.reduce((a,b)=>a+b,0)/lv.length).toFixed(1)) : null;
  const damage = ge.Gems.filter(g => /멸화|Damage/i.test(g?.Name || '')).length;
  const cooldown = ge.Gems.filter(g => /홍염|Cooldown/i.test(g?.Name || '')).length;
  return { avgLevel: avg, counts: { damage, cooldown } };
}

function summarizeCards(ca){
  if (!ca) return null;
  const list = (ca.Cards || []).map(c => ({ name:c?.Name||'', icon:c?.Icon||'', awakening:c?.AwakeCount||0 }));
  let setName = '', setCount = 0;
  if (Array.isArray(ca.Effects) && ca.Effects.length) {
    const eff = ca.Effects[0];
    setName = eff?.Title || '';
    setCount = Array.isArray(eff?.Items) ? eff.Items.length : 0;
  }
  const awakeningTotal = list.reduce((a,c)=>a+(c.awakening||0),0);
  return { list, setName, setCount, awakeningTotal };
}

/* ===== 핸들러 ===== */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return okJson(res, 200, { ok:true });

  const token = process.env.LOSTARK_API_KEY;
  if (!token) return okJson(res, 500, { ok:false, error:'NO_TOKEN', hint:'Vercel 환경변수 LOSTARK_API_KEY 설정 필요' });

  const name = String(req.query.name || '').trim();
  if (!name) return okJson(res, 400, { ok:false, error:'NO_NAME' });

  const enc = encodeURIComponent(name);

  const [pr, eq, en, ge, ca] = await Promise.all([
    hit(`${BASE}/${enc}/profiles`,   token, 'profiles'),
    hit(`${BASE}/${enc}/equipment`,  token, 'equipment'),
    hit(`${BASE}/${enc}/engravings`, token, 'engravings'),
    hit(`${BASE}/${enc}/gems`,       token, 'gems'),
    hit(`${BASE}/${enc}/cards`,      token, 'cards'),
  ]);

  const fails = [pr, eq, en, ge, ca].filter(x => !x.ok);
  if (fails.length) {
    return okJson(res, 502, {
      ok:false,
      error:'UPSTREAM_FAILED',
      fail: fails.map(f => ({ which:f.which, status:f.status, snippet:f.body })),
      sources: {
        profiles:`${BASE}/${enc}/profiles`,
        equipment:`${BASE}/${enc}/equipment`,
        engravings:`${BASE}/${enc}/engravings`,
        gems:`${BASE}/${enc}/gems`,
        cards:`${BASE}/${enc}/cards`
      }
    });
  }

  const profile = pr.json || {};
  const equipment = Array.isArray(eq.json) ? eq.json.map(mapEquip) : [];
  const engraves = mapEngraves(en.json);
  const gems = summarizeGems(ge.json);
  const cards = summarizeCards(ca.json);

  // 전투력 결정: 1) CombatPower 필드 2) Stats에서 전투력 라인
  const combatPower = profile?.CombatPower ?? pickCombatPowerFromStats(profile) ?? null;

  const data = {
    name: profile?.CharacterName || name,
    server: profile?.ServerName || profile?.Server || '-',
    cls: profile?.CharacterClassName || profile?.ClassName || '-',
    avatar: profile?.CharacterImage || '',
    itemLevelText: pickIlv(profile),
    stats: Array.isArray(profile?.Stats) ? profile.Stats : [],
    combatPower,
    equipment,
    engraves: engraves.map(e => (e.Level ? `${e.Name} Lv.${e.Level}` : e.Name)).filter(Boolean),
    gems,
    cards
  };

  return okJson(res, 200, {
    ok:true,
    requestedName: name,
    normalizedName: data.name,
    data
  });
}
