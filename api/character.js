// /api/character.js
// Lost Ark 캐릭터 프록시: 호환 + 디버그 + 장비/전투력 확장
export default async function handler(req, res) {
  // CORS (GitHub Pages 허용)
  res.setHeader("Access-Control-Allow-Origin", "https://jangstar00.github.io");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { name: rawName, debug, plain } = req.query;
    const API_KEY = process.env.LOSTARK_API_KEY;

    if (!rawName || String(rawName).trim() === "") {
      return res.status(400).json({ ok: false, error: "name 쿼리 필요" });
    }
    if (!API_KEY) {
      return res.status(500).json({ ok: false, error: "서버에 LOSTARK_API_KEY 없음" });
    }

    const name = decodeURIComponent(String(rawName)).trim();
    const encName = encodeURIComponent(name);

    const base = "https://developer-lostark.game.onstove.com";
    const headers = { Authorization: `bearer ${API_KEY}`, Accept: "application/json" };

    const fetchJSON = async (path) => {
      const url = `${base}${path}`;
      const r = await fetch(url, { headers });
      if (r.status === 404 || r.status === 204) return { status: r.status, data: null, url };
      const text = await r.text();
      try {
        const json = text ? JSON.parse(text) : null;
        return { status: r.status, data: json, url };
      } catch {
        return { status: r.status, data: null, url, parseError: true, body: text };
      }
    };

    const [profile, equips, engraves] = await Promise.all([
      fetchJSON(`/armories/characters/${encName}/profiles`),
      fetchJSON(`/armories/characters/${encName}/equipment`),
      fetchJSON(`/armories/characters/${encName}/engravings`),
    ]);

    // ── 매핑 (프론트가 원하는 필드 전부 포함) ───────────────────────────────
    const statsArr = Array.isArray(profile?.data?.Stats) ? profile.data.Stats : [];

    const mapped = {
      name: profile?.data?.CharacterName ?? "--",
      server: profile?.data?.ServerName ?? "--",
      cls: profile?.data?.CharacterClassName ?? "--",
      avatar: profile?.data?.CharacterImage ?? "",
      itemLevelText:
        profile?.data?.ItemAvgLevel ??
        profile?.data?.ItemMaxLevel ??
        profile?.data?.ItemLevel ??
        "--",
      itemLevelNum:
        Number(
          (profile?.data?.ItemMaxLevel ??
            profile?.data?.ItemAvgLevel ??
            "0"
          ).replace(/,/g, "")
        ) || 0,

      // 원본 Stats 통째로 (전투력/공격력 파싱 및 UI 표시용)
      stats: statsArr,

      // 전투력: 전투력 > 공격력 순으로 추출
      combatPower: (() => {
        const pick = (kw) =>
          statsArr.find(s => String(s?.Type || s?.Name || "").includes(kw))?.Value;
        return pick("전투력") || pick("공격력") || "--";
      })(),

      // 장비: KLOA 풍 표시를 위해 아이콘/품질/툴팁까지 모두 포함
      equipment: Array.isArray(equips?.data)
        ? equips.data.map(e => ({
            type: e.Type || "",                 // 무기/투구 등
            name: e.Name || "",
            grade: e.Grade || "",               // 유물/고대/전설/영웅/희귀...
            icon: e.Icon || "",                 // 썸네일
            quality: typeof e.Quality === "number" ? e.Quality : null, // 0~100
            tooltip: e.Tooltip || ""            // JSON(string)
          }))
        : [],

      // 각인: 이름/레벨/설명
      engraves:
        engraves?.data?.Effects?.map?.(e => ({
          name: e.Name || "",
          level: (e.Description && (e.Description.match(/Lv\.(\d)/)?.[1]))
            ? Number(RegExp.$1) : null,
          desc: e.Description || ""
        })) ?? []
    };

    const ok =
      (mapped.name && mapped.name !== "--") ||
      mapped.itemLevelNum > 0 ||
      (mapped.equipment?.length || 0) > 0 ||
      (mapped.engraves?.length || 0) > 0;

    if (String(plain) === "1") {
      // 예전 UI 호환: 매핑만
      return res.status(200).json(mapped);
    }

    // 통합 응답: data + 최상위 미러
    const payload = {
      ok,
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
      ...mapped
    };

    if (String(debug) === "1") {
      payload.raw = {
        profile: profile?.data ?? null,
        equipment: equips?.data ?? null,
        engraves: engraves?.data ?? null,
      };
    }

    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}