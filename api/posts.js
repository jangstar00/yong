// api/posts.js
// 서버리스 함수: 게시판 CRUD (메모리 저장 기본, Vercel Blob 옵션)
// 런타임: Node 18+

/* =========================
   선택 1) 메모리 저장 (기본)
   - 배포/재시작 시 초기화됨 (데모/소규모 용)
========================= */
let MEM = [];

/* =========================
   선택 2) Vercel Blob 사용 (영구 저장)
   - 아래 주석 해제 + 환경변수 설정 필요
   - npm 패키지 설치 없이 @vercel/blob 사용 가능 (Edge/Node 모두)
   - ENV:
     BLOB_READ_WRITE_TOKEN=...
========================= */
// import { put, list, del, head } from '@vercel/blob';
// const BLOB_KEY = 'posts.json';
// async function blobLoad(){ try{ const res = await fetch((await head(BLOB_KEY)).downloadUrl); return await res.json(); } catch{ return []; } }
// async function blobSave(arr){ await put(BLOB_KEY, JSON.stringify(arr), { access: 'public', contentType: 'application/json' }); }

export default async function handler(req, res) {
  /* ===== CORS: character.js와 동일한 화이트리스트 ===== */
  const ORIGIN = req.headers.origin || '';
  const ALLOWLIST = [
    'https://jangstar00.github.io',
    'https://yong-qgw8.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ];
  if (ALLOWLIST.includes(ORIGIN)) {
    res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://jangstar00.github.io');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // 캐시 금지 (게시판은 즉시 반영)
  res.setHeader('Cache-Control', 'no-store');

  try {
    // ▼ Blob 사용 시: 최초 1회 로드 (메모리 싱크)
    // if (!MEM.length) MEM = await blobLoad();

    if (req.method === 'GET') {
      // 최신순 정렬
      const out = [...MEM].sort((a,b)=> (b.ts||0)-(a.ts||0));
      return res.status(200).json(out);
    }

    if (req.method === 'POST') {
      const { author = '익명', content = '', pwdHash = '' } = req.body || {};
      if (!content || typeof content !== 'string') return res.status(400).send('내용 누락');
      if (!pwdHash || typeof pwdHash !== 'string') return res.status(400).send('pwdHash 누락');

      // 간단 필터링
      const a = String(author).slice(0, 40).trim();
      const c = String(content).slice(0, 2000).trim();
      if (!c) return res.status(400).send('내용이 비어있음');

      const post = {
        id: globalThis.crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2),
        author: a || '익명',
        content: c,
        pwdHash,
        ts: Date.now()
      };
      MEM.push(post);

      // ▼ Blob 사용 시 저장
      // await blobSave(MEM);

      return res.status(201).json(post);
    }

    if (req.method === 'DELETE') {
      const { id, pwdHash } = req.body || {};
      if (!id || !pwdHash) return res.status(400).send('id/pwdHash 누락');

      const idx = MEM.findIndex(p => p.id === id && p.pwdHash === pwdHash);
      if (idx === -1) return res.status(403).send('비밀번호 불일치 또는 글 없음');

      MEM.splice(idx, 1);

      // ▼ Blob 사용 시 저장
      // await blobSave(MEM);

      return res.status(204).end();
    }

    return res.status(405).send('Method Not Allowed');
  } catch (e) {
    return res.status(500).send(String(e?.message || e));
  }
}