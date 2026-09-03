// Manga Creative Studio － ローカル開発用のかんたんなサーバー
//   ・public/ の中身をそのまま配信する
//   ・/api/assist    企画・アイデア出しアシスタント（テキスト＋画像）
//   ・/api/plan      ネーム（構成）づくり
//   ・/api/generate  漫画生成（画像生成モデル）
//
// 実際の処理内容は shared/manga-core.js にあります。
// Cloudflare Pages（functions/api/）とまったく同じロジックを共有しているため、
// 手元で動いたものがそのまま公開先でも動きます。
//
// APIキーは環境変数 OPENAI_API_KEY からのみ読み込む（コードには書かない）。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FriendlyError,
  readConfig,
  handleAssist,
  handlePlan,
  handleGenerate,
} from './shared/manga-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3001;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
// .env の読み込み（外部ライブラリは使わない）
// ---------------------------------------------------------------------------

function loadEnvFile() {
  const file = path.join(__dirname, '.env');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return; // .env が無くても環境変数が直接指定されていれば動く
  }
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const eq = text.indexOf('=');
    if (eq === -1) continue;
    const key = text.slice(0, eq).trim();
    let value = text.slice(eq + 1).trim();
    // 値が引用符で囲まれていたら外す
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // すでに環境変数がある場合はそちらを優先する
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

// ---------------------------------------------------------------------------
// HTTP サーバー
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const MAX_BODY = 12 * 1024 * 1024; // ラフ画像を含むので少し大きめ

function sendJson(res, status, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new FriendlyError(413, 'ラフ画像のサイズが大きすぎます。10MB以下の画像をお使いください。'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (err) {
        reject(new FriendlyError(400, '送信データを読み取れませんでした。画面を再読み込みしてお試しください。'));
      }
    });
    req.on('error', () => reject(new FriendlyError(400, '通信が途中で切れました。もう一度お試しください。')));
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  // public/ の外に出るパスは拒否する
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ページが見つかりません');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'POST') return sendJson(res, 405, { message: '対応していないリクエストです。' });
    try {
      const body = await readJsonBody(req);
      const config = readConfig(process.env);
      if (url.pathname === '/api/assist') return sendJson(res, 200, await handleAssist(body, config));
      if (url.pathname === '/api/plan') return sendJson(res, 200, await handlePlan(body, config));
      if (url.pathname === '/api/generate') return sendJson(res, 200, await handleGenerate(body, config));
      return sendJson(res, 404, { message: '対応していないリクエストです。' });
    } catch (err) {
      if (err instanceof FriendlyError) return sendJson(res, err.status, { message: err.message });
      console.error('想定外のエラー:', err.name);
      return sendJson(res, 500, {
        message: '処理に失敗しました。しばらく時間をおいて再度お試しください。',
      });
    }
  }

  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  const keyReady = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
  // キーそのものは絶対に表示しない。設定済みかどうかだけ知らせる。
  console.log(`Manga Creative Studio: http://localhost:${PORT}`);
  console.log(`OpenAI APIキー: ${keyReady ? '設定済み' : '未設定（.env に OPENAI_API_KEY を設定してください）'}`);
});
