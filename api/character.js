// /api/character.js
// Vercel: Edge/Node 둘 다 동작. 환경변수 LOSTARK_API_KEY 사용(있으면).
export const config = { runtime: 'edge' };

const API_KEY = process.env.LOSTARK_API_KEY || '';
const ARM = 'https://developer-lostark.game.onstove.com/armories/characters';

async function getJSON(url) {
  const headers = API_KEY ? { Authorization: `bearer ${API_KEY}` } : {};
  const r = await fetch(url, { headers, cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function tryJSON(url) {
  try { return await getJSON(url); } catch { return null; }
}

// 공식 모바일 페이지(HTML)에서 전투력/아바타 보강
async function fetchOfficialHTML(name) {
  const url = 'https://m-lostark.game.onstove.com/Profile/Character/' + encodeURIComponent(name);
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept-Language': 'ko-KR,ko;q=0.9'
    },
    cache: 'no-store'
  });
  if (!r.ok) throw new Error(`OFFICIAL ${r.status}`);
  return r.text();
}
function parseOfficial(html) {
  const s = html.replace(/\s+/g, ' ');
  const combatPower = ((s.match(/전투력[^0-9]*([0-9][0-9.,]*)/i) || [])[1]) || null;
  const avatar = ((s.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) || [])[1]) || null;
  return { combatPower, avatar };
}

// tooltip 평탄화
function flattenTooltip(raw) {
  if (!raw) return '';
  let j = raw;
  if (typeof raw === 'string') {
    try { j = JSON.parse(raw.replace(/\\"/g, '"')); } catch { return ''; }
  }
  if (typeof j !== 'object' || !j) return '';
  const pick = [];
  for (const k in j) {
    const v = j[k] && j[k].value;
    pick.push(
      (v && v.Element_000 && v.Element_000.contentStr) ||
      (v && v.Element_001 && v.Element_001.contentStr) ||
      (v && v.Element_002 && v.Element_002.contentStr) ||
      (v && v.Element_000) || (v && v.leftStr) || (v && v.rightStr) ||
      (typeof v === 'string' ? v : '') || ''
    );
  }
  return pick.filter(Boolean).join('\n');
}
const stripTags = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
function extractAffixOptions(raw) {
  return flattenTooltip(raw)
    .split(/\n|<br>|<BR>/i)
    .map(x => x.replace(/&nbsp;/g, ' ').trim())
    .filter(Boolean)
    .map(stripTags)
    .filter(x => /^(상|중|하)\b/.test(x));
}

// 강화/상재/단계/티어/엘릭서/초월 파싱
function parseEquipMeta(name, grade, tooltipRaw) {
  const t = (flattenTooltip(tooltipRaw) + ' ' + (name || '') + ' ' + (grade || '')).replace(/\s+/g, ' ');
  const getNum = (re) => { const m = re.exec(t); return m ? Number(m[1]) : null; };
  const enhance = getNum(/\+ *(\d{1,2})/);
  const upper   = getNum(/x *(\d{1,2})/i);
  const step    = getNum(/(\d{1,2})\s*단계/);
  const tierN   = getNum(/티어\s*([0-9])/i);
  const tier    = tierN ? `T${tierN}` : null;

  // 초월 표기 예) "초월 Lv.7×21" 혹은 "초월 7단계 누적 21"
  const trans = (() => {
    let avg = null, total = null;
    const a = t.match(/초월[^L]*Lv\.?\s*([0-9]{1,2})\D*×\D*([0-9]{1,3})/i);
    if (a) { avg = Number(a[1]); total = Number(a[2]); }
    const b = t.match(/초월[^0-9]*([0-9]{1,2})\s*단계[^0-9]*([0-9]{1,3})/);
    if (!a && b) { avg = Number(b[1]); total = Number(b[2]); }
    if (avg || total) return { avg: avg || null, total: total || null };
    return null;
  })();

  // 엘릭서 예) "엘릭서 22.84%" / "엘릭서 Lv.??"
  const elixir = (() => {
    const m = t.match(/엘릭서[^0-9]*([0-9]{1,3}(?:\.[0-9]+)?)%/);
    if (m) return { percent: Number(m[1]) };
    const m2 = t.match(/엘릭서[^L]*Lv\.?\s*([0-9]{1,2})/i);
    if (m2) return { level: Number(m2[1]) };
    return null;
  })();

  return { enhance, upper, step, tier, transcend: trans, elixir };
}

function gradeClass(grade) {
  const g = String(grade || '');
  if (/고대/.test(g)) return 'ancient';
  if (/유물/.test(g)) return 'relic';
  if (/전설/.test(g)) return 'legendary';
  if (/영웅/.test(g)) return 'epic';
  if (/희귀/.test(g)) return 'rare';
  if (/고급/.test(g)) return 'uncommon';
  return 'common';
}

function pickCombatPower(stats) {
  const arr = Array.isArray(stats) ? stats : [];
  const f = kw => arr.find(s => String(s?.Type || s?.Name || '').includes(kw))?.Value || null;
  return f('전투력') || f('Combat Power') || null;
}

// 보석 요약
function summarizeGems(gemsObj) {
  const list = (gemsObj && (gemsObj.Gems || gemsObj.gems || [])) || [];
  if (!Array.isArray(list) || !list.length) return { avgLevel: null, counts: {}, list: [] };
  let sum = 0;
  const counts = {};
  const out = list.map(g => {
    const lv = Number(g.Level || g.level || 0);
    const name = g.Name || g.name || '';
    const typeKey = /치명타|피해|공격/.test(name) ? 'damage' : /쿨|재사용/.test(name) ? 'cooldown' : 'other';
    counts[typeKey] = (counts[typeKey] || 0) + 1;
    sum += lv;
    return { level: lv, name, icon: g.Icon || g.icon || '' };
  });
  return { avgLevel: Math.round((sum / list.length) * 100) / 100, counts, list: out };
}

// 카드 요약
function summarizeCards(cardsObj) {
  const list = (cardsObj && (cardsObj.Cards || cardsObj.cards || [])) || [];
  const effects = (cardsObj && (cardsObj.Effects || cardsObj.effects || [])) || [];
  let setName = null, setCount = null, awakeningTotal = 0;
  for (const c of list) awakeningTotal += Number(c.AwakeCount || c.awakening || 0);
  // 효과 설명에서 세트/조건 추출 시도
  if (effects.length) {
    const txt = effects.map(e => (e.Items || e.items || []).map(i => i.Description || i.description || '').join('\n')).join('\n');
    const m = txt.match(/(\S+)\s*세트\s*([0-9]+)\s*세트/i);
    if (m) { setName = m[1]; setCount = Number(m[2]); }
  }
  return {
    list: list.map(c => ({ name: c.Name || c.name || '', icon: c.Icon || c.icon || '', awakening: c.AwakeCount || c.awakening || 0 })),
    setName, setCount, awakeningTotal
  };
}

function normalize(profile, equipment, engr, gems, cards) {
  const p = profile || {};
  const eq = Array.isArray(equipment) ? equipment : [];
  const engrs = (engr && Array.isArray(engr.Engravings)) ? engr.Engravings : [];
  return {
    name: p.CharacterName || '-',
    server: p.ServerName || '-',
    cls: p.CharacterClassName || '-',
    avatar: p.CharacterImage || '',
    itemLevelText: p.ItemMaxLevel || p.ItemAvgLevel || p.ItemLevel || '-',
    stats: Array.isArray(p.Stats) ? p.Stats : [],
    equipment: eq.map(x => ({
      slot: x.Type || x.Slot || '',
      name: x.Name || '',
      grade: x.Grade || '',
      icon: x.Icon || '',
      quality: typeof x.Quality === 'number' ? x.Quality : null,
      tooltip: x.Tooltip || ''
    })),
    engraves: engrs.map(e => (e.Name ? `${e.Name}${e.Level ? ' Lv.' + e.Level : ''}` : '')).filter(Boolean),
    gems: gems || null,
    cards: cards || null
  };
}

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name');
    if (!name) return new Response('name required', { status: 400 });

    // 병렬 호출
    const [profile, equipment, engr, gems, cards] = await Promise.all([
      tryJSON(`${ARM}/${encodeURIComponent(name)}/profiles`),
      tryJSON(`${ARM}/${encodeURIComponent(name)}/equipment`),
      tryJSON(`${ARM}/${encodeURIComponent(name)}/engravings`),
      tryJSON(`${ARM}/${encodeURIComponent(name)}/gems`),
      tryJSON(`${ARM}/${encodeURIComponent(name)}/cards`)
    ]);

    let data = normalize(profile, equipment, engr, gems, cards);

    // 장비 메타/부옵 파싱
    data.equipment = (data.equipment || []).map(it => {
      const lines = extractAffixOptions(it.tooltip);
      return {
        ...it,
        gradeClass: gradeClass(it.grade),
        lines,
        meta: parseEquipMeta(it.name, it.grade, it.tooltip)
      };
    });

    // 보석/카드 요약
    const gemSum = summarizeGems(gems || {});
    const cardSum = summarizeCards(cards || {});

    // 전투력
    let combatPower = pickCombatPower(data.stats);
    if (!combatPower) {
      try {
        const html = await fetchOfficialHTML(name);
        const { combatPower: cpOff, avatar: avOff } = parseOfficial(html);
        if (cpOff) combatPower = cpOff;
        if (!data.avatar && avOff) data.avatar = avOff;
      } catch { /* ignore */ }
    }

    const out = {
      name: data.name,
      server: data.server,
      cls: data.cls,
      avatar: data.avatar,
      itemLevelText: data.itemLevelText,
      stats: data.stats,
      combatPower: combatPower || null,
      engraves: data.engraves,
      equipment: data.equipment,
      gems: gemSum,
      cards: cardSum
    };

    return new Response(JSON.stringify(out), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}