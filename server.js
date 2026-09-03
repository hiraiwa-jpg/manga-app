'use strict';

// Manga Creative Studio － OpenAI API 連携用のかんたんなサーバー
//   ・public/ の中身をそのまま配信する
//   ・/api/assist    企画・アイデア出しアシスタント（テキスト＋画像）
//   ・/api/generate  漫画生成（画像生成モデル）
// APIキーは環境変数 OPENAI_API_KEY からのみ読み込む（コードには書かない）。

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const PUBLIC_DIR = path.join(__dirname, 'public');

// モデル名は環境変数で差し替えられるようにしておく
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini';
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2';

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
// 受講生にも分かりやすいエラーメッセージに変換する
// ---------------------------------------------------------------------------

class FriendlyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function friendlyMessageFor(status, kind) {
  const target = kind === 'image' ? '画像生成' : 'アシスタントの回答';
  if (status === 401 || status === 403) {
    return 'OpenAI APIキーが正しくないようです。.env のキーを確認してください。';
  }
  if (status === 429) {
    return 'アクセスが集中しているか、利用上限に達しました。しばらく時間をおいて再度お試しください。';
  }
  if (status === 404) {
    return `使用中のモデル（${kind === 'image' ? IMAGE_MODEL : TEXT_MODEL}）を利用できませんでした。お使いのアカウントで使えるモデル名か確認してください。`;
  }
  if (status === 400) {
    return `入力内容が受け付けられませんでした。${target}の指示を短くするなど、内容を変えてお試しください。`;
  }
  if (status >= 500) {
    return 'OpenAI側が混み合っているようです。しばらく時間をおいて再度お試しください。';
  }
  return `${target}に失敗しました。しばらく時間をおいて再度お試しください。`;
}

function requireApiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !key.trim() || key.trim() === 'your_openai_api_key_here') {
    throw new FriendlyError(
      400,
      'OpenAI APIキーが設定されていません。.env ファイルに OPENAI_API_KEY を設定して、サーバーを再起動してください。'
    );
  }
  return key.trim();
}

// OpenAI へのリクエスト共通処理
async function callOpenAI(endpoint, payload, kind, timeoutMs) {
  const apiKey = requireApiKey();
  let res;
  try {
    res = await fetch(`https://api.openai.com/v1/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // ネットワーク断・タイムアウトなど（err にキーは含まれない）
    console.error(`[${endpoint}] 通信エラー:`, err.name);
    throw new FriendlyError(
      504,
      '通信に時間がかかりすぎました。ネットワークを確認して、しばらく時間をおいて再度お試しください。'
    );
  }

  const text = await res.text();
  if (!res.ok) {
    let detail = '';
    try {
      detail = JSON.parse(text)?.error?.message || '';
    } catch (_) {
      /* JSON でなければ無視 */
    }
    console.error(`[${endpoint}] OpenAI エラー ${res.status}: ${detail}`);
    throw new FriendlyError(res.status, friendlyMessageFor(res.status, kind));
  }

  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// 1. 企画・アイデア出しアシスタント
// ---------------------------------------------------------------------------

const CONSULT_TYPES = [
  'ラフ画像の改善案がほしい',
  '手書きラフからセリフを考えたい',
  'キャラ設定を相談したい',
  'あらすじを相談したい',
  'コマ割りや構図を相談したい',
];

const SYSTEM_PROMPT = [
  'あなたは漫画制作を支援する編集者アシスタントです。',
  '日本語で、初心者にも分かりやすく、具体的で実践しやすいアドバイスを返してください。',
  '回答は「改善案：」のような短い見出しから始め、そのあとに「・」で始まる箇条書きを3〜5個並べてください。',
  '前置きや挨拶、締めの決まり文句は書かず、本題だけを簡潔に書いてください。',
].join('\n');

async function handleAssist(body) {
  const consultType = CONSULT_TYPES.includes(body.consultType)
    ? body.consultType
    : CONSULT_TYPES[0];
  const userText = String(body.text || '').trim();
  const image = typeof body.image === 'string' ? body.image : '';

  if (!userText && !image) {
    throw new FriendlyError(
      400,
      '相談内容を入力するか、ラフ画像をアップロードしてください。'
    );
  }

  const content = [
    {
      type: 'input_text',
      text: [
        `相談したい内容：${consultType}`,
        userText ? `作者からの相談：\n${userText}` : '作者からの補足コメントはありません。',
        image ? '添付のラフ画像も踏まえてアドバイスしてください。' : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];

  // 画像が添付されていれば、そのまま画像入力として渡す（data URL 形式）
  if (image) content.push({ type: 'input_image', image_url: image });

  const data = await callOpenAI(
    'responses',
    {
      model: TEXT_MODEL,
      instructions: SYSTEM_PROMPT,
      input: [{ role: 'user', content }],
      max_output_tokens: 800,
    },
    'text',
    60000
  );

  // output の中から本文テキストを取り出す
  const answer = (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('\n')
    .trim();

  if (!answer) {
    throw new FriendlyError(502, 'アシスタントの回答を受け取れませんでした。もう一度お試しください。');
  }
  return { answer };
}

// ---------------------------------------------------------------------------
// 2. 漫画生成
//    (1) /api/plan     ストーリーをページ数に配分した「ネーム（構成）」を作る
//    (2) /api/generate 1ページ分ずつ、そのページの担当場面だけを画像にする
// ---------------------------------------------------------------------------

const TONE_STYLES = {
  少年漫画風: 'Japanese shonen manga style, dynamic action lines, bold inking, energetic poses',
  少女漫画風: 'Japanese shojo manga style, delicate lines, large expressive eyes, decorative flower patterns',
  ギャグ漫画風: 'Japanese gag manga style, exaggerated deformed expressions, comedic timing',
  ファンタジー風: 'Japanese fantasy manga style, detailed backgrounds, magical atmosphere',
  日常漫画風: 'Japanese slice-of-life manga style, calm everyday scenes, soft lines',
};

// 配色の指示。ページごとに色がバラつかないよう、強めの言い方で固定する
const COLOR_MODES = {
  mono: {
    label: '白黒（モノクロ）',
    lead: 'Strictly BLACK AND WHITE monochrome manga page. Absolutely no color anywhere.',
    tail: 'Reminder: the whole page must be pure black-and-white monochrome — black ink, white paper, and grey screentone only. No colored ink, no coloring, not even on the hair, eyes, clothes or background.',
  },
  color: {
    label: 'カラー',
    lead: 'FULL COLOR manga page. Every panel is fully colored.',
    tail: 'Reminder: the whole page must be in full color — color every panel, including hair, eyes, clothes and backgrounds. Do not leave any panel in black and white.',
  },
};

function readColorMode(value) {
  return COLOR_MODES[value] ? COLOR_MODES[value] : COLOR_MODES.mono;
}

function readGenerateInput(body) {
  const story = String(body.story || '').trim();
  if (!story) {
    throw new FriendlyError(400, 'ストーリーを入力してから「漫画を生成する」を押してください。');
  }
  return {
    story: story.slice(0, 2000),
    pages: Math.min(Math.max(parseInt(body.pages, 10) || 1, 1), 8),
    panels: Math.min(Math.max(parseInt(body.panels, 10) || 4, 1), 6),
    tone: String(body.tone || '少年漫画風'),
  };
}

// --- (1) ネーム（構成）づくり ------------------------------------------------

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    characters: {
      type: 'string',
      description:
        'Short English description of the recurring characters (age, hairstyle, clothes) so every page draws them the same way.',
    },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          page: { type: 'integer', description: 'Page number, starting at 1.' },
          summary: { type: 'string', description: 'このページで起きることの日本語の要約（40文字程度）。' },
          panels: {
            type: 'array',
            items: { type: 'string', description: 'English description of what is drawn in one panel.' },
          },
        },
        required: ['page', 'summary', 'panels'],
        additionalProperties: false,
      },
    },
  },
  required: ['characters', 'pages'],
  additionalProperties: false,
};

async function handlePlan(body) {
  const { story, pages, panels, tone } = readGenerateInput(body);

  const instructions = [
    'あなたは漫画のネーム（構成）を作る編集者です。',
    `与えられたストーリー全体を、${pages}ページに無理なく配分してください。`,
    '各ページは前のページの続きになるようにし、同じ場面を別のページで繰り返さないでください。',
    `最後の${pages}ページ目でストーリーが完結するようにしてください。`,
    `各ページには、そのページに描くコマの説明をちょうど${panels}個入れてください。`,
    'summary は日本語、characters と panels は画像生成に渡すため英語で書いてください。',
  ].join('\n');

  const data = await callOpenAI(
    'responses',
    {
      model: TEXT_MODEL,
      instructions,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [`漫画の雰囲気：${tone}`, `ページ数：${pages}`, `1ページあたりのコマ数：${panels}`, `ストーリー：\n${story}`].join('\n'),
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'manga_plan',
          strict: true,
          schema: PLAN_SCHEMA,
        },
      },
      max_output_tokens: 2000,
    },
    'text',
    90000
  );

  const raw = (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('')
    .trim();

  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (err) {
    throw new FriendlyError(502, '漫画の構成を作れませんでした。ストーリーを少し具体的にして、もう一度お試しください。');
  }

  const planPages = Array.isArray(plan.pages) ? plan.pages : [];
  if (planPages.length === 0) {
    throw new FriendlyError(502, '漫画の構成を作れませんでした。もう一度お試しください。');
  }

  // ページ数が足りない・多い場合でも指定枚数に揃える
  const normalized = [];
  for (let i = 1; i <= pages; i++) {
    const found = planPages.find((pg) => Number(pg.page) === i) || planPages[i - 1] || planPages[planPages.length - 1];
    normalized.push({
      page: i,
      summary: String(found.summary || '').trim() || `${i}ページ目`,
      panels: (Array.isArray(found.panels) ? found.panels : []).map((t) => String(t)).slice(0, panels),
    });
  }

  return { characters: String(plan.characters || ''), pages: normalized };
}

// --- (2) 1ページ分の画像生成 --------------------------------------------------

function buildImagePrompt({ pages, panels, tone, pageNumber, characters, pagePlan, previousSummary, story, colorMode }) {
  const style = TONE_STYLES[tone] || TONE_STYLES['少年漫画風'];
  const panelLines = (pagePlan.panels || []).map((text, i) => `Panel ${i + 1}: ${text}`);

  return [
    // 配色の指示は先頭に置く（全ページで同じ文章にして色がブレないようにする）
    colorMode.lead,
    `A single page of a Japanese manga (${style}).`,
    `The page is divided into exactly ${panels} panels with clear white gutters between them, read right to left.`,
    `This is page ${pageNumber} of a ${pages}-page story.`,
    characters ? `Recurring characters (keep their design identical on every page): ${characters}` : '',
    previousSummary ? `What already happened on the previous page (do NOT draw it again): ${previousSummary}` : '',
    // このページで描く内容だけを渡すのが重要（全体を渡すと毎ページ同じ絵になる）
    'Draw ONLY the scenes listed below. Do not depict any other part of the story.',
    panelLines.length ? panelLines.join('\n') : `Scene for this page: ${pagePlan.summary || story}`,
    pageNumber === pages ? 'This is the final page, so it should feel like the ending of the story.' : '',
    'Include speech bubbles with very short Japanese lines. Keep the text minimal. No page numbers, no watermarks, no signatures.',
    // 末尾でもう一度念押しする（先頭だけだと後半のページで無視されやすい）
    colorMode.tail,
  ]
    .filter(Boolean)
    .join('\n');
}

async function handleGenerate(body) {
  const { story, pages, panels, tone } = readGenerateInput(body);
  const pageNumber = Math.min(Math.max(parseInt(body.pageNumber, 10) || 1, 1), pages);

  const pagePlan =
    body.pagePlan && typeof body.pagePlan === 'object'
      ? { summary: String(body.pagePlan.summary || ''), panels: Array.isArray(body.pagePlan.panels) ? body.pagePlan.panels : [] }
      : { summary: '', panels: [] };

  const data = await callOpenAI(
    'images/generations',
    {
      model: IMAGE_MODEL,
      prompt: buildImagePrompt({
        pages,
        panels,
        tone,
        pageNumber,
        story,
        colorMode: readColorMode(body.colorMode),
        characters: String(body.characters || '').slice(0, 600),
        pagePlan,
        previousSummary: String(body.previousSummary || '').slice(0, 300),
      }),
      size: '1024x1536', // 漫画ページらしい縦長
      n: 1,
    },
    'image',
    180000 // 画像生成は時間がかかるので長めに待つ
  );

  const b64 = data?.data?.[0]?.b64_json;
  const url = data?.data?.[0]?.url;
  if (!b64 && !url) {
    throw new FriendlyError(502, '画像生成に失敗しました。しばらく時間をおいて再度お試しください。');
  }

  return { image: b64 ? `data:image/png;base64,${b64}` : url, pageNumber };
}

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
      if (url.pathname === '/api/assist') return sendJson(res, 200, await handleAssist(body));
      if (url.pathname === '/api/plan') return sendJson(res, 200, await handlePlan(body));
      if (url.pathname === '/api/generate') return sendJson(res, 200, await handleGenerate(body));
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
