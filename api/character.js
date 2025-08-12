// api/character.js
export default async function handler(req, res) {
  const { name } = req.query;
  const API_KEY = process.env.LOSTARK_API_KEY;

  // --- CORS 설정 (GitHub Pages 호출 허용) ---
  res.setHeader("Access-Control-Allow-Origin", "https://jangstar00.github.io");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // --- 요청 유효성 체크 ---
  if (!name) {
    return res.status(400).json({ error: "name 쿼리 필요" });
  }
  if (!API_KEY) {
    return res.status(500).json({ error: "LOSTARK_API_KEY 누락" });
  }

  try {
    // --- Lost Ark API 요청 ---
    const apiRes = await fetch(
      `https://developer-lostark.game.onstove.com/armories/characters/${encodeURIComponent(
        name
      )}`,
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
        },
      }
    );

    if (!apiRes.ok) {
      const txt = await apiRes.text().catch(() => "");
      return res
        .status(apiRes.status)
        .json({ error: "LoA API 오류", detail: txt });
    }

    const data = await apiRes.json();

    return res.status(200).json(data);
  } catch (err) {
    return res
      .status(500)
      .json({ error: "프록시 에러", detail: err?.message || err });
  }
}