// /api/character.js
export const config = { runtime: 'edge' }; // Vercel Edge도 OK

const API_KEY = process.env.LOSTARK_API_KEY; // 있으면 사용
const BASE = 'https://developer-lostark.game.onstove.com/armories/characters';

async function fetchJSON(url){
  const r = await fetch(url, { headers: { Authorization: `bearer ${API_KEY}` }, cache:'no-store' });
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// 공식 모바일 프로필 HTML 긁기
async function fetchOfficialHTML(name){
  const url = 'https://m-lostark.game.onstove.com/Profile/Character/' + encodeURIComponent(name);
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept-Language': 'ko-KR,ko;q=0.9'
    },
    cache:'no-store'
  });
  if(!r.ok) throw new Error(`OFFICIAL ${r.status}`);
  const html = await r.text();
  return { html, url };
}

// HTML에서 전투력/아바타/장비 메타 대충 캐기
function parseOfficial(html){
  const clean = html.replace(/\s+/g,' ');
  // 전투력 2,542.74 같은 포맷
  const cp = (() => {
    const m = clean.match(/전투력[^0-9]*([0-9][0-9.,]*)/i);
    return m ? m[1].trim() : null;
  })();
  // og:image에 큰 프로필 이미지가 들어오는 경우가 많음
  const avatar = (() => {
    const m = clean.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    return m ? m[1] : null;
  })();

  // 장비 블록에서 품질/강화/상재 추출(보수적)
  // 품질 94, +19, x40, 7단계, (티어 4)
  const equip = [];
  // 모바일 페이지는 장비 섹션이 반복되며 품질 숫자/강화 텍스트가 근처에 붙는다.
  const itemBlocks = clean.split(/(?:장착중|아이템 레벨)/).slice(1, 30);
  for(const block of itemBlocks){
    const quality = ((block.match(/품질 *([0-9]{1,3})/i)||[])[1]) || null;
    const enhance = ((block.match(/\+ *([0-9]{1,2})/)||[])[1]) || null;
    const upper   = ((block.match(/x *([0-9]{1,2})/i)||[])[1]) || null;
    const step    = ((block.match(/([0-9]{1,2})\s*단계/i)||[])[1]) || null;
    const tier    = ((block.match(/티어\s*([0-9])/i)||[])[1]) || null;
    // 아이콘
    const icon = ((block.match(/<img[^>]+src="([^"]+)"[^>]*>/i)||[])[1]) || null;
    equip.push({ quality: quality? Number(quality): null, meta: {
      enhance: enhance? Number(enhance): null,
      upper: upper? Number(upper): null,
      step: step? Number(step): null,
      tier: tier? `T${tier}`: null
    }, icon });
  }

  return { combatPower: cp, avatar, equip };
}

function normalizeArmory(profile, equipment, engr){
  const p = profile || {};
  const eq = Array.isArray(equipment)? equipment: [];
  const engrs = (engr && Array.isArray(engr.Engravings)) ? engr.Engravings : [];
  // 통합 plain 형태
  return {
    name: p.CharacterName || '-',
    server: p.ServerName || '-',
    cls: p.CharacterClassName || '-',
    avatar: p.CharacterImage || '',
    itemLevelText: p.ItemMaxLevel || p.ItemAvgLevel || p.ItemLevel || '-',
    stats: Array.isArray(p.Stats)? p.Stats: [],
    equipment: eq.map(x=>({
      name: x.Name || '',
      grade: x.Grade || '',
      icon: x.Icon || '',
      Quality: typeof x.Quality==='number'? x.Quality : null,
      Tooltip: x.Tooltip || ''
    })),
    engraves: engrs.map(e => (e.Name ? `${e.Name}${e.Level? ' Lv.'+e.Level: ''}` : '')).filter(Boolean)
  };
}

function pickCombatPower(stats){
  if(!Array.isArray(stats)) return null;
  const find = kw => stats.find(s => String(s?.Type||s?.Name||'').includes(kw))?.Value || null;
  return find('전투력') || find('Combat Power') || find('공격력') || null;
}

export default async function handler(req){
  try{
    const { searchParams } = new URL(req.url);
    const name = searchParams.get('name');
    if(!name) return new Response('name required', { status: 400 });

    // 1) OpenAPI 먼저
    let profile=null, equipment=null, engr=null;
    try{
      [profile, equipment, engr] = await Promise.all([
        fetchJSON(`${BASE}/${encodeURIComponent(name)}/profiles`),
        fetchJSON(`${BASE}/${encodeURIComponent(name)}/equipment`),
        fetchJSON(`${BASE}/${encodeURIComponent(name)}/engravings`).catch(()=>null)
      ]);
    }catch(_){ /* 무시하고 오피셜로 백업 */ }

    let data = normalizeArmory(profile, equipment, engr||{Engravings:[]});

    // 2) 전투력/아바타 없는 경우 공식 페이지 파싱으로 보강
    let cp = pickCombatPower(data.stats);
    if(!cp || !data.avatar){
      try{
        const { html } = await fetchOfficialHTML(name);
        const parsed = parseOfficial(html);
        if(!cp && parsed.combatPower) cp = parsed.combatPower;
        if(!data.avatar && parsed.avatar) data.avatar = parsed.avatar;
        // 장비 메타 보강(품질/강화/상재 등)
        if(Array.isArray(data.equipment) && parsed.equip.length){
          data.equipment = data.equipment.map((it, idx) => {
            const b = parsed.equip[idx] || {};
            return {
              ...it,
              Quality: typeof it.Quality==='number' ? it.Quality : (typeof b.quality==='number'? b.quality : null),
              icon: it.icon || b.icon || it.Icon || '',
              _meta: b.meta || null
            };
          });
        }
      }catch(e){ /* 못 가져오면 무시 */ }
    }

    // 최종 가공: 프론트가 기대하는 plain=1 스키마
    const out = {
      name: data.name,
      server: data.server,
      cls: data.cls,
      avatar: data.avatar,
      itemLevelText: data.itemLevelText,
      stats: data.stats,
      combatPower: cp || null,
      engraves: data.engraves,
      equipment: (data.equipment||[]).map(it => ({
        Name: it.name, Grade: it.grade, Icon: it.icon,
        Quality: it.Quality ?? null,
        Tooltip: it.Tooltip || '',
        // 공식 페이지로부터 주운 메타를 덧붙임
        meta: it._meta || null
      }))
    };

    return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control':'no-store' }});
  }catch(e){
    return new Response(JSON.stringify({ ok:false, error:String(e.message||e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}