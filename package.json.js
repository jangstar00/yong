// api/posts.js
// Vercel Blob을 사용해 JSON을 저장합니다.
// 환경변수: BLOB_READ_WRITE_TOKEN (Vercel → Storage → Blob → Token 생성)
import { put, get } from '@vercel/blob';

const BUCKET_KEY = 'lostamen-posts.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://jangstar00.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const current = await readPosts();
      return res.status(200).json(current);
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const { author = '', content = '', pwdHash } = body || {};
      if (!content || !pwdHash) return res.status(400).send('content/pwdHash required');
      const current = await readPosts();
      const post = { id: Date.now().toString(36) + Math.random().toString(36).slice(2), author, content, ts: Date.now(), pwdHash };
      current.push(post);
      await writePosts(current);
      return res.status(201).json(post);
    }

    if (req.method === 'DELETE') {
      const body = await readBody(req);
      const { id, pwdHash } = body || {};
      if (!id || !pwdHash) return res.status(400).send('id/pwdHash required');
      const current = await readPosts();
      const idx = current.findIndex(p => String(p.id) === String(id));
      if (idx < 0) return res.status(404).send('not found');
      if (current[idx].pwdHash !== pwdHash) return res.status(403).send('forbidden');
      current.splice(idx, 1);
      await writePosts(current);
      return res.status(204).end();
    }

    return res.status(405).send('method not allowed');
  } catch (e) {
    return res.status(500).send(e?.message || 'server error');
  }
}

async function readPosts() {
  try {
    const file = await get(BUCKET_KEY);
    const text = await (await fetch(file.url)).text();
    return JSON.parse(text || '[]');
  } catch {
    return [];
  }
}

async function writePosts(arr) {
  await put(BUCKET_KEY, JSON.stringify(arr), {
    access: 'public',
    addRandomSuffix: false, // 동일 키에 덮어쓰기
    contentType: 'application/json; charset=utf-8',
  });
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
