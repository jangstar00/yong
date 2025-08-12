// /api/character.js
// Lost Ark 캐릭터 정보를 한 번에 모아주는 프록시.
// - name: 캐릭터명 (필수)
// - debug=1: 원본 응답 동봉
// - plain=1: 이전 UI 호환(매핑 결과만 반환)

export default async function handler(req, res) {
  // CORS (GitHub Pages 호출 허용)
  res.setHeader("Access-Control-Allow-Origin", "https://jangstar00.github.io");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { name: rawName, debug, plain } = req.query;
    const API_KEY = process.env.LOSTARK_API_KEY;

    // 1) 파라미터·키 검증
    if (!rawName || String(rawName).trim() === "") {
      return res.status(400).json({ ok: false, error: "name 쿼리 필요" });
    }
    if (!API_KEY) {
      return res.status(500).json({ ok: false, error: "서버에 LOSTARK_API_KEY 없음" });
    }

    // 2) 인코딩 일관화
    const name = decodeURIComponent(String(rawName)).trim();
    const encName = encodeURIComponent(name);

    // 3) 공통 fetch 유틸
    const base = "https://developer-lostark.game.onstove.com";
    const headers = {
      Authorization: `bearer ${API_KEY}`,
      Accept: "application/json",
    };
    const fetchJSON = async (path) => {
      const url = `${base}${path}`;
      const r = await fetch(url, { headers });
      // 일부 엔드포인트가 200이면서 빈 배열/객체 주기도 함
      if (r.status === 404 || r.status === 204) return { status: r.status, data: null, url };
      const text = await r.text();
      try {
        const json = text ? JSON.parse(text) : null;
        return { status: r.status, data: json, url };
      } catch {
        return { status: r.status, data: null, url, parseError: true, body: text };
      }
    };

    // 4) 병렬 호출
    const [profile, equips, engraves] = await Promise.all([
      fetchJSON(`/armories/characters/${encName}/profiles`),
      fetchJSON(`/armories/characters/${encName}/equipment`),
      fetchJSON(`/armories/characters/${encName}/engravings`),
    ]);

    // 5) 비정상 상황 빠르게 표기
    const gotAny =
      (profile && profile.data) ||
      (equips && Array.isArray(equips.data) && equips.data.length) ||
      (engraves && engraves.data && engraves.data.Effects && engraves.data.Effects.length);

    // 6) 매핑
    const mapped = {
      name: profile?.data?.CharacterName ?? "--",
      server: profile?.data?.ServerName ?? "--",
      cls: profile?.data?.CharacterClassName ?? "--",
      avatar: profile?.data?.CharacterImage ?? "",
      itemLevelText: profile?.data?.ItemAvgLevel ?? "--",
      itemLevelNum: Number(
        (profile?.data?.ItemMaxLevel ?? profile?.data?.ItemAvgLevel ?? "0").replace(/,/g, "")
      ) || 0,
      combatPower: profile?.data?.Stats?.find?.(s => s.Type === "공격력")?.Value ?? "--",
      equipment: Array.isArray(equips?.data)
        ? equips.data.map(e => ({
            type: e.Type || "",
            name: e.Name || "",
            grade: e.Grade || "",
          }))
        : [],
      engraves:
        engraves?.data?.Effects?.map?.(e => ({
          name: e.Name || "",
          desc: e.Description || "",
        })) ?? [],
    };

    // 7) plain 모드면 예전 UI 그대로
    if (String(plain) === "1") {
      return res.status(200).json(mapped);
    }

    // 8) 디버그 포함 모드
    const payload = {
      ok: !!gotAny,
      requestedName: rawName,
      normalizedName: name,
      sources: {
        profile: profile?.url,
        equipment: equips?.url,
        engraves: engraves?.url,
      },
      status: {
        profile: profile?.status ?? null,
        equipment: equips?.status ?? null,
        engraves: engraves?.status ?? null,
      },
      data: mapped,
    };

    if (String(debug) === "1") {
      payload.raw = {
        profile: profile?.data ?? null,
        equipment: equips?.data ?? null,
        engraves: engraves?.data ?? null,
      };
    }

    // 데이터가 진짜 하나도 없으면 그래도 200에 ok=false로 내려서 프론트가 안내문 띄우기 쉽게 함
    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}