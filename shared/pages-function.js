// Cloudflare Pages Functions 用の共通ラッパー
//
// server.js の「JSONを受け取る → 処理する → JSONで返す」という流れを、
// Cloudflare の Request / Response の形に合わせ直しているだけのファイルです。

import { FriendlyError, readConfig } from './manga-core.js';

const MAX_BODY = 12 * 1024 * 1024; // ラフ画像を含むので少し大きめ

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function makeHandler(handler) {
  return async function onRequestPost(context) {
    let body;
    try {
      const length = Number(context.request.headers.get('content-length') || 0);
      if (length > MAX_BODY) {
        return json(413, { message: 'ラフ画像のサイズが大きすぎます。10MB以下の画像をお使いください。' });
      }
      body = await context.request.json();
    } catch (err) {
      return json(400, { message: '送信データを読み取れませんでした。画面を再読み込みしてお試しください。' });
    }

    try {
      return json(200, await handler(body, readConfig(context.env)));
    } catch (err) {
      if (err instanceof FriendlyError) return json(err.status, { message: err.message });
      // 想定外のエラーは中身を返さない（キーが混ざる事故を防ぐため）
      console.error('想定外のエラー:', err.name);
      return json(500, { message: '処理に失敗しました。しばらく時間をおいて再度お試しください。' });
    }
  };
}
