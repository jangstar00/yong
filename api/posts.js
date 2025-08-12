// 간단 프론트 통합본: 요청 + 안전 매핑 + 렌더 + 디버그

const $log = (msg) => {
  const box = document.querySelector("#debug") || (() => {
    const d = document.createElement("pre");
    d.id = "debug";
    d.style.whiteSpace = "pre-wrap";
    d.style.fontSize = "12px";
    d.style.padding = "8px";
    d.style.background = "rgba(255,255,255,0.06)";
    d.style.borderRadius = "8px";
    d.style.margin = "8px 0";
    d.style.maxHeight = "55vh";
    d.style.overflow = "auto";
    d.innerText = "API Debug\n";
    document.body.appendChild(d);
    return d;
  })();
  box.textContent += (typeof msg === "string" ? msg : JSON.stringify(msg, null, 2)) + "\n";
};

const pick = (obj, paths, fallback="--") => {
  for (const p of paths) {
    try {
      const val = p.split(".").reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), obj);
      if (val !== undefined && val !== null && val !== "") return val;
    } catch {}
  }
  return fallback;
};

function normalizePayload(res) {
  const d = res?.data && typeof res.data === "object" ? res.data : res || {};
  return {
    name: pick(res, ["data.name", "name"]),
    server: pick(res, ["data.server", "server"]),
    cls: pick(res, ["data.cls", "cls"]),
    avatar: pick(res, ["data.avatar", "avatar"], ""),
    itemLevelText: pick(res, ["data.itemLevelText", "itemLevelText"]),
    itemLevelNum: Number(pick(res, ["data.itemLevelNum", "itemLevelNum"], 0)) || 0,
    combatPower: pick(res, ["data.combatPower", "combatPower"]),
    equipment: Array.isArray(d.equipment) ? d.equipment : [],
    engraves: Array.isArray(d.engraves) ? d.engraves : [],
    ok: !!res?.ok
  };
}

async function fetchChar(name, { debug = true, plain = false } = {}) {
  const url = new URL("https://yong-qgw8.vercel.app/api/character");
  url.searchParams.set("name", name);
  if (debug) url.searchParams.set("debug", "1");
  if (plain) url.searchParams.set("plain", "1");

  $log(`[REQ] ${name}`);
  $log({ url: url.toString() });

  const r = await fetch(url.toString(), { cache: "no-store" });
  const j = await r.json().catch(() => ({}));

  $log(`[RES ${name}] status=${r.status}`);
  $log(j);

  return j;
}

function renderCard(target, res) {
  const el = document.querySelector(target);
  if (!el) return;

  const d = normalizePayload(res);
  const f = (v, empty="--") => (v === undefined || v === null || v === "" ? empty : v);

  el.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;">
      <img src="${f(d.avatar, "")}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;background:#222;" />
      <div>
        <div style="font-weight:700">${f(d.name)}</div>
        <div style="opacity:.8">${f(d.server)} | ${f(d.cls)}</div>
        <div style="opacity:.8">아이템 레벨: ${f(d.itemLevelText)} (${Number(d.itemLevelNum)||0})</div>
        <div style="opacity:.8">전투력: ${f(d.combatPower)}</div>
      </div>
    </div>
    <div style="margin-top:8px">
      <div style="font-weight:600;margin:6px 0">각인</div>
      <ul style="margin:0;padding-left:18px">
        ${
          (d.engraves||[])
            .map(e => `<li>${e.name || ""} <span style="opacity:.7">${e.desc || ""}</span></li>`)
            .join("") || `<li style="opacity:.7">없음</li>`
        }
      </ul>
    </div>
  `;

  if (!d.ok) {
    el.insertAdjacentHTML(
      "beforeend",
      `<div style="margin-top:6px;color:#ff7a7a">데이터 없음. API 키/캐릭터명/지역 제한 확인</div>`
    );
  }
}

async function main() {
  const names = [
    "장용노예2호",
    "아장르카웅나",
    "오바때끼",
    "애이르",
  ];

  for (const n of names) {
    const res = await fetchChar(n, { debug: true, plain: false });
    renderCard(`#card-${encodeURIComponent(n)}`, res);
  }
}

document.addEventListener("DOMContentLoaded", main);