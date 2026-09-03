# Manga Creative Studio（漫画制作アプリ）

企画アシスタントと漫画生成をまとめた、OpenAI API 連携のWebアプリです。

## できること

- **企画アシスタント** — アイデア出しや設定づくりを対話で手伝います（`/api/assist`）
- **プロット作成** — 企画内容から構成を組み立てます（`/api/plan`）
- **漫画生成** — 画像生成モデルでコマを作ります（`/api/generate`）

## 構成

```
漫画制作アプリ/
├── shared/
│   ├── manga-core.js      中核ロジック（ローカルと公開先で共有）
│   └── pages-function.js  Cloudflare 用の入出力ラッパー
├── server.js              ローカル開発用サーバー（Node）
├── functions/api/         Cloudflare Pages Functions
│   ├── assist.js
│   ├── plan.js
│   └── generate.js
├── public/
│   ├── index.html   画面
│   ├── style.css    見た目
│   └── app.js       画面の動き
├── .env.example     環境変数のひな形
└── package.json
```

外部ライブラリは使っていません。

OpenAI を呼ぶ処理は `shared/manga-core.js` に集約し、ローカル（`server.js`）と
Cloudflare（`functions/api/`）が同じコードを共有しています。
そのため、**手元で動いたものはそのまま公開先でも動きます**。ロジックを直すときは
`shared/manga-core.js` の1か所だけを直してください。

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

## Cloudflare Pages への公開（限定公開）

このアプリは OpenAI を呼ぶため、静的サイトとしては動きません。
API は Pages Functions（`functions/api/`）として動かします。

### ビルド設定

| 項目 | 値 |
|---|---|
| フレームワーク プリセット | なし |
| ビルド コマンド | （空欄） |
| ビルド出力ディレクトリ | `public` |
| ルート ディレクトリ | （空欄） |

### 環境変数（シークレット）

Pages の 設定 → 環境変数 で `OPENAI_API_KEY` を **シークレット（暗号化）** として登録します。
シークレットにするとダッシュボードでもビルドログでも値が伏せられ、ブラウザにも渡りません。

### アクセス制限は必須

制限なしで公開すると、URLを知った第三者が画像生成を実行でき、**その料金が自分に請求されます**。
Cloudflare Access（Zero Trust）で自分のメールアドレスだけを許可してください。
Access はサイト全体（`/api/*` を含む）の手前に入ります。

安全な設定順序は次のとおりです。

1. コードをプッシュする（この時点ではキー未設定なので、APIは動かない＝安全）
2. Cloudflare Access を設定する
3. 最後に `OPENAI_API_KEY` をシークレットとして登録し、再デプロイする

この順番なら「動く状態なのに誰でもアクセスできる」時間が発生しません。

### 既知の制約

画像生成（`/api/generate`）は完了まで時間がかかります。Cloudflare は1リクエストあたり
**約100秒**で打ち切るため、生成に時間がかかると 524 エラーになることがあります。
その場合はページ数を減らすか、手元（localhost）で生成してください。
