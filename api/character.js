// api/character.js
export default async function handler(req, res) {
  // ===== CORS: 동적 화이트리스트 =====
  const ORIGIN = req.headers.origin || '';
  const ALLOWLIST = [
    'https://jangstar00.github.io',     // GitHub Pages
    'https://yong-qgw8.vercel.app',     // 본 배포
    'http://localhost:3000',            // 로컬 테스트
    'http://127.0.0.1:3000'
  ];
  if (ALLOWLIST.includes(ORIGIN)) {
    res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  } else {
    // 안전하게 기본 허용 (원한다면 '*'로도 가능)
    res.setHeader('Access-Control-Allow-Origin', 'https://jangstar00.github.io');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');

  if (req.method === 'OPTIONS') {
    return res.status(204).end(); // 프리플라이트
  }

  try {
    const name = (req.query?.name || '').trim();
    const API_KEY = process.env.LOSTARK_API_KEY;

    if (!name) return res.status(400).json({ error: 'name 쿼리 필요' });
    if (!API_KEY) return res.status(500).json({ error: 'LOSTARK_API_KEY 누락' });

    // ===== Lost Ark API: 필요한 섹션만 필터로 보장
    // 프런트는 ArmoryProfile/ArmoryEquipment/ArmoryEngraving/Stats를 기대함
    const base = 'https://developer-lostark.game.onstove.com';
    const url  = `${base}/armories/characters/${encodeURIComponent(name)}?filters=profiles,equipment,engravings,stats`;

    const apiRes = await fetch(url, {
      headers: { Authorization: `Bearer ${API_KEY}` }
    });

    const text = await apiRes.text();
    // 일부 케이스에서 JSON 아니라 text로 올 수도 있어 안전 파싱
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    // 캐시(짧게) – 선택
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: 'LoA API 오류', detail: data });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: '프록시 에러', detail: String(err?.message || err) });
  }
}