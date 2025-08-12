// /api/character.js
// Next.js (Vercel) API Route
// Lost Ark Open API 프록시 + 통합 응답 + CORS 완전개방

const LA_HOST = 'https://developer-lostark.game.onstove.com';
const UA = 'lostamen-proxy/1.0';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // 필요하면 도메인으로 좁혀라
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  // 캐싱은 프론트가 알아서. 여긴 항상 최신이 낫다.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(url, token, retries = 2, timeoutMs = 10000) {
  for (let i = 0; i <= retries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': UA,
          Accept: 'application/json',
        },
        signal: ac.signal,
      });
      clearTimeout(t);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      if (i === retries) throw err;
      await sleep(400 * Math.pow(2, i));
    }
  }
}

function parseItemLevelText(p) {
  return (
    p?.ItemMaxLevel ||
    p?.ItemAvgLevel ||
    p?.ItemLevel ||
    p?.['Item Max Level'] ||
    p?.['Item Avg Level'] ||
    p?.['Item Level'] ||
    '-'
  );
}

function toEquip(e) {
  if (!e) return null;
  return {
    type: e.Type || e.Slot || '',
    name: e.Name || '',
    grade: e.Grade || '',
    icon: e.Icon || '',
    quality: typeof e.Quality === 'number' ? e.Quality : null,
    tooltip: e.Tooltip || '',
  };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = process.env.LOSTARK_API_KEY;
    if (!token) return res.status(500).json({ ok: false, error: 'NO_TOKEN' });

    const name = String(req.query.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'NO_NAME' });

    const enc = encodeURIComponent(name);

    const urls = {
      profile:   `${LA_HOST}/armories/characters/${enc}/profiles`,
      equipment: `${LA_HOST}/armories/characters/${enc}/equipment`,
      engraves:  `${LA_HOST}/armories/characters/${enc}/engravings`,
      gems:      `${LA_HOST}/armories/characters/${enc}/gems`,
      cards:     `${LA_HOST}/armories/characters/${enc}/cards`,
      // 필요하면 더 추가
    };

    // 병렬 but 온건하게
    const [profile, equipment, engraves, gems, cards] = await Promise.all([
      fetchJson(urls.profile, token).catch(() => null),
      fetchJson(urls.equipment, token).catch(() => []),
      fetchJson(urls.engrav es, token).catch(() => null),
      fetchJson(urls.gems, token).catch(() => null),
      fetchJson(urls.cards, token).catch(() => null),
    ]);

    // 통합 매핑
    const p = profile || {};
    const armoryEngr = (engraves && engraves.Engravings) ? engraves.Engravings : (engraves || []);
    const engrList = Array.isArray(armoryEngr)
      ? armoryEngr.map(e => (e?.Name || '') + (e?.Level ? ` Lv.${e.Level}` : '')).filter(Boolean)
      : [];

    const equipArr = Array.isArray(equipment) ? equipment.map(toEquip).filter(Boolean) : [];

    // 전투력은 스탯에서 훔치거나 없음 처리
    const stats = Array.isArray(p.Stats) ? p.Stats : [];
    const combatStat =
      stats.find(s => String(s.Type || s.Name || '').includes('전투력')) ||
      stats.find(s => String(s.Type || s.Name || '').toLowerCase().includes('combat'));
    const combatPower = combatStat ? (combatStat.Value || combatStat.value) : null;

    // 카드 요약
    let cardsOut = null;
    if (cards && (cards.Cards || cards.Effects)) {
      const list = (cards.Cards || []).map(c => ({
        name: c?.Name || '',
        icon: c?.Icon || '',
        awakening: c?.AwakeCount || 0,
      }));
      let setName = '';
      let setCount = 0;
      if (Array.isArray(cards.Effects) && cards.Effects.length) {
        const eff = cards.Effects[0];
        setName = eff?.Title || '';
        setCount = Array.isArray(eff?.Items) ? eff.Items.length : 0;
      }
      const awakeningTotal = list.reduce((a, c) => a + (c.awakening || 0), 0);
      cardsOut = { list, setName, setCount, awakeningTotal };
    }

    // 보석 요약
    let gemsOut = null;
    if (gems && Array.isArray(gems.Gems)) {
      const lv = gems.Gems.map(g => g.Level || 0);
      const avg = lv.length ? (lv.reduce((a, b) => a + b, 0) / lv.length).toFixed(1) : null;
      const counts = {
        damage: (gems.Gems || []).filter(g => /멸화|Damage/i.test(g.Name || '')).length,
        cooldown: (gems.Gems || []).filter(g => /홍염|Cooldown/i.test(g.Name || '')).length,
      };
      gemsOut = { avgLevel: avg ? Number(avg) : null, counts };
    }

    const data = {
      name: p.CharacterName || name,
      server: p.ServerName || p.Server || '-',
      cls: p.CharacterClassName || p.ClassName || '-',
      avatar: p.CharacterImage || '',
      itemLevelText: parseItemLevelText(p),
      stats: p.Stats || [],
      combatPower: combatPower || null,
      equipment: equipArr,
      engraves: engrList,
      gems: gemsOut,
      cards: cardsOut,
    };

    return res.status(200).json({
      ok: true,
      requestedName: name,
      normalizedName: p.CharacterName || name,
      sources: urls,
      status: {
        profile: profile ? 200 : 204,
        equipment: Array.isArray(equipment) ? 200 : 204,
        engraves: engraves ? 200 : 204,
        gems: gems ? 200 : 204,
        cards: cards ? 200 : 204,
      },
      data,
    });
  } catch (err) {
    // 에러도 CORS 살려서 리턴
    return res.status(500).json({
      ok: false,
      error: String(err && err.message || err),
    });
  }
}
