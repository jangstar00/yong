// pages/api/character.js  (Pages Router일 때)
// app/api/character/route.js 쓰는 프로젝트면 말해준 구조로 옮겨라.
export const config = { runtime: 'nodejs' };

const LA = 'https://developer-lostark.game.onstove.com';
const UA = 'lostamen-proxy/diag-1.2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Vary': 'Origin',
  'Cache-Control': 'no-store'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function hit(url, token, label, retries = 1) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': UA }
      });
      const text = await r.text();
      if (!r.ok) return { ok: false, which: label, status: r.status, body: text };
      try { return { ok: true, which: label, json: JSON.parse(text) }; }
      catch { return { ok: true, which: label, json: text ? JSON.parse(text) : {} }; }
    } catch (e) {
      lastErr = String(e && e.message || e);
      await sleep(400);
    }
  }
  return { ok: false, which: label, status: 0, body: lastErr || 'fetch failed' };
}

const ilv = p => p?.ItemMaxLevel || p?.ItemAvgLevel || p?.ItemLevel ||
                 p?.['Item Max Level'] || p?.['Item Avg Level'] || p?.['Item Level'] || '-';

const equipMap = e => e && ({
  type: e.Type || e.Slot || '',
  name: e.Name || '',
  grade: e.Grade || '',
  icon: e.Icon || '',
  quality: typeof e.Quality === 'number' ? e.Quality : null,
  tooltip: e.Tooltip || ''
});

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); res.end(); return; }
  const headers = { ...CORS, 'Content-Type': 'application/json; charset=utf-8' };

  const token = process.env.LOSTARK_API_KEY;
  if (!token) {
    res.writeHead(500, headers);
    res.end(JSON.stringify({ ok:false, error:'NO_TOKEN', hint:'Vercel 환경변수 LOSTARK_API_KEY 설정하라' }));
    return;
  }

  const name = String(req.query.name || '').trim();
  if (!name) {
    res.writeHead(400, headers);
    res.end(JSON.stringify({ ok:false, error:'NO_NAME' }));
    return;
  }

  const enc = encodeURIComponent(name);
  const urls = {
    profile:   `${LA}/armories/characters/${enc}/profiles`,
    equipment: `${LA}/armories/characters/${enc}/equipment`,
    engraves:  `${LA}/armories/characters/${enc}/engravings`,
    gems:      `${LA}/armories/characters/${enc}/gems`,
    cards:     `${LA}/armories/characters/${enc}/cards`,
  };

  // 한 번에 때리고 실패도 그대로 수집
  const [pr, eq, en, ge, ca] = await Promise.all([
    hit(urls.profile, token, 'profile'),
    hit(urls.equipment, token, 'equipment'),
    hit(urls.engraves, token, 'engravings'),
    hit(urls.gems, token, 'gems'),
    hit(urls.cards, token, 'cards'),
  ]);

  // 실패가 하나라도 있으면 그대로 노출(프론트 디버그에 뜸)
  const errs = [pr, eq, en, ge, ca].filter(x => !x.ok);
  if (errs.length) {
    res.writeHead(502, headers);
    res.end(JSON.stringify({
      ok:false,
      error:'UPSTREAM_FAILED',
      fail: errs.map(x => ({ which:x.which, status:x.status, snippet: String(x.body).slice(0,300) })),
      sources: urls
    }));
    return;
  }

  const p = pr.json || {};
  const stats = Array.isArray(p.Stats) ? p.Stats : [];
  const cp = stats.find(s => String(s.Type||s.Name||'').includes('전투력')) ||
             stats.find(s => String(s.Type||s.Name||'').toLowerCase().includes('combat'));
  const combatPower = cp ? (cp.Value || cp.value) : null;

  const engrArr = (en.json && (en.json.Engravings || en.json)) ? (en.json.Engravings || en.json) : [];
  const engravesOut = Array.isArray(engrArr)
    ? engrArr.map(e => (e?.Name || '') + (e?.Level ? ` Lv.${e.Level}` : '')).filter(Boolean)
    : [];

  let gemsOut = null;
  if (ge.json && Array.isArray(ge.json.Gems)) {
    const lv = ge.json.Gems.map(g => g.Level || 0);
    const avg = lv.length ? Number((lv.reduce((a,b)=>a+b,0)/lv.length).toFixed(1)) : null;
    const counts = {
      damage: (ge.json.Gems||[]).filter(g => /멸화|Damage/i.test(g.Name || '')).length,
      cooldown: (ge.json.Gems||[]).filter(g => /홍염|Cooldown/i.test(g.Name || '')).length
    };
    gemsOut = { avgLevel: avg, counts };
  }

  let cardsOut = null;
  if (ca.json && (ca.json.Cards || ca.json.Effects)) {
    const list = (ca.json.Cards || []).map(c => ({ name:c?.Name||'', icon:c?.Icon||'', awakening:c?.AwakeCount||0 }));
    let setName = '', setCount = 0;
    if (Array.isArray(ca.json.Effects) && ca.json.Effects.length) {
      const eff = ca.json.Effects[0];
      setName = eff?.Title || '';
      setCount = Array.isArray(eff?.Items) ? eff.Items.length : 0;
    }
    const awakeningTotal = list.reduce((a,c)=>a+(c.awakening||0),0);
    cardsOut = { list, setName, setCount, awakeningTotal };
  }

  const data = {
    name: p.CharacterName || name,
    server: p.ServerName || p.Server || '-',
    cls: p.CharacterClassName || p.ClassName || '-',
    avatar: p.CharacterImage || '',
    itemLevelText: ilv(p),
    stats: p.Stats || [],
    combatPower,
    equipment: Array.isArray(eq.json) ? eq.json.map(equipMap).filter(Boolean) : [],
    engraves: engravesOut,
    gems: gemsOut,
    cards: cardsOut
  };

  res.writeHead(200, headers);
  res.end(JSON.stringify({
    ok:true,
    requestedName:name,
    normalizedName:data.name,
    status:{ profile:200, equipment:200, engraves:200, gems:200, cards:200 },
    sources: urls,
    data
  }));
}
