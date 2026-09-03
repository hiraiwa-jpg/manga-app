# Manga Creative Studio（漫画制作アプリ）

企画アシスタントと漫画生成をまとめた、OpenAI API 連携のWebアプリです。

## できること

- **企画アシスタント** — アイデア出しや設定づくりを対話で手伝います（`/api/assist`）
- **プロット作成** — 企画内容から構成を組み立てます（`/api/plan`）
- **漫画生成** — 画像生成モデルでコマを作ります（`/api/generate`）

## 構成

```
漫画制作アプリ/
├── server.js        Node標準モジュールだけで動くサーバー
├── public/
│   ├── index.html   画面
│   ├── style.css    見た目
│   └── app.js       画面の動き
├── .env.example     環境変数のひな形
└── package.json
```

外部ライブラリは使っていません。Node.js だけで動きます。

## 使い方

### 1. APIキーを設定する

`.env.example` をコピーして `.env` を作り、自分の OpenAI APIキーを書きます。

```bash
cp .env.example .env
```

`.env` の中身：

```
OPENAI_API_KEY=（ここに自分のAPIキー）
```

> `.env` は `.gitignore` で除外されているため、GitHubには上がりません。
> APIキーをソースコードに直接書かないでください。

### 2. サーバーを起動する

```bash
npm start
```

### 3. ブラウザで開く

http://localhost:3001

## 環境変数

| 変数名 | 必須 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | 必須 | なし | OpenAI のAPIキー |
| `PORT` | 任意 | `3001` | サーバーのポート番号 |
| `OPENAI_TEXT_MODEL` | 任意 | `gpt-4.1-mini` | テキスト生成に使うモデル |
| `OPENAI_IMAGE_MODEL` | 任意 | `gpt-image-2` | 画像生成に使うモデル |

## 注意

- `server.js` を編集したときは、サーバーを再起動しないと変更が反映されません（`Ctrl + C` で止めてから `npm start`）。
- APIキーは絶対にコミットしないでください。
