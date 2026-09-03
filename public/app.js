// Manga Creative Studio － 画面と OpenAI API をつなぐ処理
// APIキーはサーバー側（server.js）だけが持つ。ブラウザには渡さない。

// ---------------------------------------------------------------------------
// 共通：サーバーへのリクエスト
// ---------------------------------------------------------------------------

async function postJson(url, payload) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error('サーバーに接続できませんでした。サーバーが起動しているか確認してください。');
  }

  let data = {};
  try {
    data = await res.json();
  } catch (err) {
    /* JSON でない応答は下でまとめて扱う */
  }

  if (!res.ok) {
    throw new Error(data.message || '処理に失敗しました。しばらく時間をおいて再度お試しください。');
  }
  return data;
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

function clearError(el) {
  el.textContent = '';
  el.hidden = true;
}

// ---------------------------------------------------------------------------
// 1. 企画・アイデア出しアシスタント
// ---------------------------------------------------------------------------

const roughInput = document.getElementById('rough-image');
const roughName = document.getElementById('rough-filename');
const assistBtn = document.querySelector('.btn--assist');
const assistAnswer = document.getElementById('assist-answer');
const assistTag = document.getElementById('assist-tag');
const assistError = document.getElementById('assist-error');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB まで
let roughImageDataUrl = ''; // 添付されたラフ画像（data URL）

roughInput.addEventListener('change', () => {
  const file = roughInput.files[0];
  clearError(assistError);
  roughImageDataUrl = '';

  if (!file) {
    roughName.textContent = 'まだ画像は選択されていません';
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    roughInput.value = '';
    roughName.textContent = 'まだ画像は選択されていません';
    showError(assistError, '画像のサイズが大きすぎます。8MB以下の画像を選んでください。');
    return;
  }

  roughName.textContent = `読み込み中：${file.name}`;
  const reader = new FileReader();
  reader.onload = () => {
    roughImageDataUrl = reader.result;
    roughName.textContent = `選択中：${file.name}`;
  };
  reader.onerror = () => {
    roughName.textContent = 'まだ画像は選択されていません';
    showError(assistError, '画像を読み込めませんでした。別の画像でお試しください。');
  };
  reader.readAsDataURL(file);
});

assistBtn.addEventListener('click', async () => {
  const text = document.getElementById('consult-text').value.trim();
  const consultType = document.getElementById('consult-type').value;

  clearError(assistError);
  if (!text && !roughImageDataUrl) {
    showError(assistError, '相談内容を入力するか、ラフ画像をアップロードしてください。');
    return;
  }

  assistBtn.disabled = true;
  assistBtn.textContent = '相談中…';
  assistTag.textContent = 'AIが考えています';
  assistAnswer.classList.add('is-loading');
  assistAnswer.textContent = 'アシスタントが回答を作成しています。少しお待ちください…';

  try {
    const data = await postJson('/api/assist', {
      consultType,
      text,
      image: roughImageDataUrl || undefined,
    });
    assistAnswer.textContent = data.answer;
    assistTag.textContent = 'AIの回答';
  } catch (err) {
    assistAnswer.textContent = '回答を表示できませんでした。';
    assistTag.textContent = 'エラー';
    showError(assistError, err.message);
  } finally {
    assistAnswer.classList.remove('is-loading');
    assistBtn.disabled = false;
    assistBtn.textContent = 'アイデアを相談する';
  }
});

// ---------------------------------------------------------------------------
// 2. 漫画生成（1枚ずつ順番に生成して、できたページから表示する）
// ---------------------------------------------------------------------------

const generateBtn = document.querySelector('.btn--generate');
const previewGrid = document.querySelector('.preview__grid');
const generateTag = document.getElementById('generate-tag');
const generateError = document.getElementById('generate-error');

function createPageCard(pageNumber, panels) {
  const card = document.createElement('article');
  card.className = 'page-card';
  card.innerHTML = `
    <div class="page-card__head">
      <span class="page-card__no">Page ${pageNumber}</span>
      <span class="page-card__layout">${panels}構成</span>
    </div>
    <p class="page-card__plan">構成を考えています…</p>
    <div class="page-card__thumb">
      <span class="page-card__thumb-icon" aria-hidden="true">🖼️</span>
      <span class="page-card__thumb-title">生成待ち</span>
      <span class="page-card__thumb-note">順番に生成します</span>
    </div>`;
  return card;
}

// そのページで何が起きるか（ネームの要約）をカードに表示する
function setPlanText(card, text) {
  card.querySelector('.page-card__plan').textContent = text;
}

function setThumbState(card, title, note, loading) {
  const thumb = card.querySelector('.page-card__thumb');
  thumb.classList.toggle('is-loading', Boolean(loading));
  thumb.querySelector('.page-card__thumb-title').textContent = title;
  thumb.querySelector('.page-card__thumb-note').textContent = note;
}

function setThumbImage(card, src, pageNumber) {
  const thumb = card.querySelector('.page-card__thumb');
  thumb.classList.remove('is-loading');
  thumb.innerHTML = '';
  const img = document.createElement('img');
  img.className = 'page-card__image';
  img.src = src;
  img.alt = `生成された漫画 ${pageNumber}ページ目`;
  thumb.appendChild(img);
}

generateBtn.addEventListener('click', async () => {
  const story = document.getElementById('story').value.trim();
  const pages = parseInt(document.getElementById('page-count').value, 10);
  const panelsLabel = document.getElementById('panel-count').value; // 例：「4コマ」
  const panels = parseInt(panelsLabel, 10);
  const tone = document.getElementById('tone').value;
  const colorMode = document.getElementById('color-mode').value; // mono / color

  clearError(generateError);
  if (!story) {
    showError(generateError, 'ストーリーを入力してから「漫画を生成する」を押してください。');
    return;
  }

  // 枚数分のカードを先に並べる
  previewGrid.innerHTML = '';
  const cards = [];
  for (let i = 1; i <= pages; i++) {
    const card = createPageCard(i, panelsLabel);
    previewGrid.appendChild(card);
    cards.push(card);
  }

  generateBtn.disabled = true;
  let done = 0;

  try {
    // --- 1. まずストーリーをページ数に配分した構成（ネーム）を作る ---
    generateBtn.textContent = '構成を考えています…';
    generateTag.textContent = `${pages}ページの構成を作成中`;

    const plan = await postJson('/api/plan', { story, pages, panels, tone });
    plan.pages.forEach((pagePlan, i) => {
      if (cards[i]) setPlanText(cards[i], `${pagePlan.page}ページ目：${pagePlan.summary}`);
    });

    // --- 2. 各ページを、そのページの担当場面だけで1枚ずつ生成する ---
    for (let i = 1; i <= pages; i++) {
      generateBtn.textContent = `生成中… (${i}/${pages}枚目)`;
      generateTag.textContent = `生成中 ${done}/${pages}枚`;
      setThumbState(cards[i - 1], '画像を生成しています…', '1枚あたり30秒ほどかかります', true);

      const data = await postJson('/api/generate', {
        story,
        pages,
        panels,
        tone,
        pageNumber: i,
        colorMode,
        characters: plan.characters,
        pagePlan: plan.pages[i - 1],
        // 前のページの内容を渡して、同じ場面を描き直さないようにする
        previousSummary: i > 1 ? plan.pages[i - 2].summary : '',
      });

      setThumbImage(cards[i - 1], data.image, i);
      done += 1;
      generateTag.textContent = `生成済み ${done}/${pages}枚`;
    }
    generateTag.textContent = `生成完了 ${done}/${pages}枚`;
  } catch (err) {
    // 途中で止まったページは分かるように表示を戻す
    cards.forEach((card) => {
      const thumb = card.querySelector('.page-card__thumb');
      if (!thumb.querySelector('.page-card__image')) {
        setThumbState(card, '生成できませんでした', 'もう一度お試しください', false);
      }
    });
    generateTag.textContent = done > 0 ? `途中まで生成 ${done}/${pages}枚` : 'エラー';
    showError(generateError, err.message);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = '漫画を生成する';
  }
});
