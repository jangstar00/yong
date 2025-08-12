// Lost Ark 캐릭터 프록시 (호환 + 디버그 내장)
// - GET /api/character?name=캐릭터명&debug=1&plain=1
export default async function handler(req, res) {
  // CORS (GitHub Pages 허용)
  res.setHeader("Access-Control-Allow-Origin", "https://jangstar00.github.io");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
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

    const mapped = {
      name: profile?.data?.CharacterName ?? "--",
      server: profile?.data?.ServerName ?? "--",
      cls: profile?.data?.CharacterClassName ?? "--",
      avatar: profile?.data?.CharacterImage ?? "",
      itemLevelText: profile?.data?.ItemAvgLevel ?? "--",
      itemLevelNum:
        Number((profile?.data?.ItemMaxLevel ?? profile?.data?.ItemAvgLevel ?? "0").replace(/,/g, "")) || 0,
      combatPower: profile?.data?.Stats?.find?.(s => s.Type === "공격력")?.Value ?? "--",
      equipment: Array.isArray(equips?.data)
        ? equips.data.map(e => ({ type: e.Type || "", name: e.Name || "", grade: e.Grade || "" }))
        : [],
      engraves: engraves?.data?.Effects?.map?.(e => ({ name: e.Name || "", desc: e.Description || "" })) ?? [],
    };

    const ok =
      (mapped.name && mapped.name !== "--") ||
      mapped.itemLevelNum > 0 ||
      (mapped.equipment?.length || 0) > 0 ||
      (mapped.engrav es?.length || 0) > 0;

    if (String(plain) === "1") {
      return res.status(200).json(mapped);
    }

    const payload = {
      ok: !!ok,
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

      // 호환용 미러(레거시 프론트 보호)
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