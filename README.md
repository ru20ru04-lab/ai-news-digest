# 今日のAIニュース（ai-news-digest）

毎朝 6 時前後（JST）に最新の AI ニュースを自動収集・日本語訳・要約し、iPhone のホーム画面から PWA として閲覧できるアプリ。

## 仕組み

```
GitHub Actions（毎日 04:30 JST 開始 → 06:00 前後 JST 配信完了）
  ├─ RSS（Anthropic / OpenAI / Google AI Blog / Google DeepMind / Meta AI / Hugging Face / The Decoder / MIT Tech Review / ITmedia AI+）
  ├─ Hacker News（AI 関連クエリ × 6）
  └─ arXiv（cs.AI / cs.LG / cs.CL）
       ↓ 60 件まで集めて重複排除
  Claude Haiku 4.5 が選定・日本語訳・要約 → 5〜7 件
       ↓ public/data/digest.json に保存・自動コミット
  GitHub Pages が静的サイトとして配信
       ↓ iPhone Safari で「ホーム画面に追加」→ PWA として動作
```

## ディレクトリ構成

```
ai-news-digest/
├── .github/workflows/daily-digest.yml  # 毎日 04:30 JST の cron（遅延吸収して 6 時前後配信）
├── scripts/
│   ├── fetch_news.py                   # 収集→Claude→JSON 出力
│   ├── generate_icons.py               # アイコン生成（一度だけ実行）
│   ├── test_collect.py                 # 収集部分のドライラン
│   └── requirements.txt
└── public/                             # GitHub Pages 公開ディレクトリ
    ├── index.html
    ├── app.js
    ├── style.css
    ├── manifest.json
    ├── sw.js                           # Service Worker（オフライン対応）
    ├── icons/                          # 192/512/180 px
    └── data/digest.json                # ← Actions が毎日更新
```

## セットアップ（初回のみ）

### 1. GitHub リポジトリ作成（パブリック）

```powershell
cd C:\Users\ooga-\Documents\WorkShop\ai-news-digest
git init
git add .
git commit -m "feat: initial AI news digest PWA"
gh repo create ai-news-digest --public --source=. --push
```

### 2. Anthropic API キーを Secrets に登録

```powershell
gh secret set ANTHROPIC_API_KEY
# プロンプトでキーを貼り付け
```

### 3. GitHub Pages を有効化

リポジトリ設定 → Pages → Source を **GitHub Actions** に設定。

### 4. 初回手動実行

リポジトリの Actions タブから「Daily AI News Digest」→「Run workflow」。
完了後、`https://<ユーザー名>.github.io/ai-news-digest/` でアクセス可能。

### 5. iPhone のホーム画面に追加

1. Safari で上記 URL を開く
2. 共有ボタン → 「ホーム画面に追加」
3. アイコンをタップで PWA として起動

## ローカル開発

```powershell
# ニュース取得（API キーが必要）
$env:ANTHROPIC_API_KEY = [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','User')
py -3.14 scripts\fetch_news.py

# 収集部分だけテスト（API キー不要）
py -3.14 scripts\test_collect.py

# プレビュー
cd public
py -3.14 -m http.server 8765
# → http://localhost:8765/ をブラウザで開く
```

## 設定変更ガイド

| 変えたいもの | 場所 |
|---|---|
| 配信時刻 | `.github/workflows/daily-digest.yml` の `cron` |
| 表示記事数 | `scripts/fetch_news.py` の `OUTPUT_ITEMS_MIN` / `MAX` |
| 要約の長さ・口調 | `scripts/fetch_news.py` の `PROMPT_TEMPLATE` |
| ソース追加 | `scripts/fetch_news.py` の `RSS_FEEDS` |
| デザイン | `public/style.css` |
| カード表示要素 | `public/app.js` の `render` 関数 |
| アプリ名・テーマ色 | `public/manifest.json` |

## コスト試算

- Claude API（Haiku 4.5）: 約 3 円 / 日 = 90 円 / 月
- GitHub Actions（パブリックリポ）: 無料
- GitHub Pages（パブリックリポ）: 無料

## ライセンス

MIT
