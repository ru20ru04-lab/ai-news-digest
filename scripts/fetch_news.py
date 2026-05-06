"""
AI ニュースダイジェスト生成スクリプト

毎日 RSS / Hacker News / arXiv から AI 関連の記事を収集し、
Claude Haiku 4.5 で重要度の高い 5〜7 件を選定・日本語訳・要約して
public/data/digest.json に出力する。

使い方:
    py -3.14 scripts/fetch_news.py

環境変数:
    ANTHROPIC_API_KEY  必須。Anthropic の API キー。
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import feedparser
import requests
from anthropic import Anthropic

JST = timezone(timedelta(hours=9))

# 日本語ソース用 AI キーワードフィルタ（タイトルに含まれる場合のみ採用）
JA_AI_KEYWORDS = [
    "AI", "ＡＩ", "ChatGPT", "Claude", "Gemini", "Copilot", "GPT",
    "LLM", "生成AI", "生成系AI", "AGI", "機械学習", "深層学習", "ディープラーニング",
    "大規模言語モデル", "OpenAI", "Anthropic", "DeepMind", "Hugging Face",
    "ロボット", "自動運転", "画像生成", "音声生成",
]

# (name, url, lang, keyword_filter)
# keyword_filter=True の場合、タイトルが JA_AI_KEYWORDS のいずれかを含む記事のみ採用（AI 専門メディアでない総合系で使用）
RSS_FEEDS: list[tuple[str, str, str, bool]] = [
    # 英語：主要 AI 企業ブログ
    ("Anthropic", "https://www.anthropic.com/news/rss.xml", "en", False),
    ("OpenAI", "https://openai.com/news/rss.xml", "en", False),
    ("Google AI Blog", "https://blog.google/technology/ai/rss/", "en", False),
    ("Google DeepMind", "https://deepmind.google/blog/rss.xml", "en", False),
    ("Meta AI", "https://ai.meta.com/blog/rss/", "en", False),
    ("Hugging Face", "https://huggingface.co/blog/feed.xml", "en", False),
    # 英語：海外メディア
    ("MIT Technology Review", "https://www.technologyreview.com/topic/artificial-intelligence/feed", "en", False),
    ("The Decoder", "https://the-decoder.com/feed/", "en", False),
    # 日本語：AI 専門メディア（フィルタ不要）
    ("ITmedia AI+", "https://rss.itmedia.co.jp/rss/2.0/aiplus.xml", "ja", False),
    ("AINOW", "https://ainow.ai/feed/", "ja", False),
    # 日本語：総合 IT メディア（タイトルキーワードで AI 関連のみ採用）
    ("Gigazine", "https://gigazine.net/news/rss_2.0/", "ja", True),
    ("ASCII", "https://ascii.jp/rss.xml", "ja", True),
    # 日本語：Google News 集約（多数の日本メディアから AI 関連を curate）
    ("Google News (JP)",
     "https://news.google.com/rss/search?q=%22%E7%94%9F%E6%88%90AI%22+OR+%22ChatGPT%22+OR+%22Claude%22+OR+%22Anthropic%22+OR+%22OpenAI%22+OR+%22LLM%22&hl=ja&gl=JP&ceid=JP:ja",
     "ja", False),
]

# 直近何時間以内の記事を対象とするか
LOOKBACK_HOURS = 36

# 1 件ずつの要約文字数
SUMMARY_CHAR_MIN = 4000  # source summary を切り詰めるサイズ

# Claude に渡す最大記事数（プロンプトサイズ抑制）
MAX_ITEMS_TO_CLAUDE = 60

# 出力する記事数
OUTPUT_ITEMS_MIN = 5
OUTPUT_ITEMS_MAX = 6

MODEL = "claude-haiku-4-5-20251001"


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text or "")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _entry_published(entry) -> datetime | None:
    for key in ("published_parsed", "updated_parsed"):
        t = getattr(entry, key, None) or entry.get(key) if hasattr(entry, "get") else None
        if t:
            return datetime.fromtimestamp(time.mktime(t), tz=timezone.utc)
    return None


def _has_ai_keyword(text: str) -> bool:
    return any(kw in text for kw in JA_AI_KEYWORDS)


def fetch_rss(name: str, url: str, lang: str = "en", keyword_filter: bool = False) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)
    items: list[dict] = []
    try:
        feed = feedparser.parse(url)
    except Exception as e:
        print(f"[WARN] RSS parse failed: {name} ({url}): {e}", file=sys.stderr)
        return items

    if not getattr(feed, "entries", None):
        print(f"[WARN] No entries: {name}", file=sys.stderr)
        return items

    # 総合系フィードは AI 関連だけに絞る（最新50件まで遡る）
    max_scan = 50 if keyword_filter else 25
    for entry in feed.entries[:max_scan]:
        published = _entry_published(entry)
        if published and published < cutoff:
            continue
        title = _strip_html(getattr(entry, "title", "") or "")
        link = getattr(entry, "link", "") or ""
        summary = _strip_html(getattr(entry, "summary", "") or getattr(entry, "description", "") or "")
        if not title or not link:
            continue
        if keyword_filter and not _has_ai_keyword(title + " " + summary[:200]):
            continue
        items.append({
            "source": name,
            "lang": lang,
            "title": title,
            "url": link,
            "summary": summary[:SUMMARY_CHAR_MIN],
            "published": published.isoformat() if published else None,
        })
    print(f"[INFO] {name} ({lang}): {len(items)} items", file=sys.stderr)
    return items


def fetch_hn() -> list[dict]:
    items: list[dict] = []
    queries = ["AI", "LLM", "GPT", "Claude", "Anthropic", "OpenAI"]
    seen_ids: set[str] = set()
    for q in queries:
        try:
            r = requests.get(
                "https://hn.algolia.com/api/v1/search",
                params={
                    "query": q,
                    "tags": "story",
                    "numericFilters": f"points>40,created_at_i>{int((datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS)).timestamp())}",
                    "hitsPerPage": 15,
                },
                timeout=15,
            )
            r.raise_for_status()
        except Exception as e:
            print(f"[WARN] HN fetch failed for '{q}': {e}", file=sys.stderr)
            continue
        for hit in r.json().get("hits", []):
            oid = hit.get("objectID")
            if not oid or oid in seen_ids:
                continue
            seen_ids.add(oid)
            title = hit.get("title") or ""
            url = hit.get("url") or f"https://news.ycombinator.com/item?id={oid}"
            if not title:
                continue
            items.append({
                "source": "Hacker News",
                "lang": "en",
                "title": title,
                "url": url,
                "summary": f"HN points: {hit.get('points', 0)}, comments: {hit.get('num_comments', 0)}",
                "published": hit.get("created_at"),
            })
    print(f"[INFO] Hacker News: {len(items)} items", file=sys.stderr)
    return items


def fetch_arxiv() -> list[dict]:
    items: list[dict] = []
    try:
        r = requests.get(
            "http://export.arxiv.org/api/query",
            params={
                "search_query": "cat:cs.AI OR cat:cs.LG OR cat:cs.CL",
                "sortBy": "submittedDate",
                "sortOrder": "descending",
                "max_results": 20,
            },
            timeout=15,
        )
        r.raise_for_status()
    except Exception as e:
        print(f"[WARN] arXiv fetch failed: {e}", file=sys.stderr)
        return items

    feed = feedparser.parse(r.content)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=LOOKBACK_HOURS * 2)  # arXiv は少し緩めに
    for entry in feed.entries:
        published = _entry_published(entry)
        if published and published < cutoff:
            continue
        title = _strip_html(entry.title)
        url = entry.link
        summary = _strip_html(getattr(entry, "summary", ""))
        items.append({
            "source": "arXiv",
            "lang": "en",
            "title": title,
            "url": url,
            "summary": summary[:SUMMARY_CHAR_MIN],
            "published": published.isoformat() if published else None,
        })
    print(f"[INFO] arXiv: {len(items)} items", file=sys.stderr)
    return items


def collect_all() -> list[dict]:
    all_items: list[dict] = []
    for name, url, lang, kf in RSS_FEEDS:
        all_items.extend(fetch_rss(name, url, lang, kf))
    all_items.extend(fetch_hn())
    all_items.extend(fetch_arxiv())

    # URL 重複排除
    seen: set[str] = set()
    deduped: list[dict] = []
    for it in all_items:
        u = it["url"].split("#")[0].rstrip("/")
        if u in seen:
            continue
        seen.add(u)
        deduped.append(it)

    # 新しい順
    def _sort_key(it: dict) -> str:
        return it.get("published") or ""

    deduped.sort(key=_sort_key, reverse=True)

    # 言語比率を確保するため、言語ごとに分けてからインターリーブ
    en_items = [it for it in deduped if it.get("lang") != "ja"]
    ja_items = [it for it in deduped if it.get("lang") == "ja"]
    # 日本語ソースは最大 20 件、残りを英語で埋める
    ja_keep = ja_items[:20]
    en_keep = en_items[: MAX_ITEMS_TO_CLAUDE - len(ja_keep)]
    return ja_keep + en_keep


PROMPT_TEMPLATE = """あなたは「AI ニュースをやさしく解説するキュレーター」です。
以下は本日収集した最新の AI 関連ニュース・記事のリストです（複数ソースから自動収集）。
各記事の先頭に [JP] / [EN] の言語タグが付いています。

{items}

このリストから、本日のAIニュースとして最も重要・有益な {n_min}〜{n_max} 件を選定し、
さらに今日全体のサマリーと、AI活用 Tips を1件作成してください。

【選定基準】
1. 複数ソースで報じられている話題を優先（トレンド性・注目度の証拠）
2. AI 業界全体への影響度が高いもの（新モデル発表、重要研究、業界再編など）
3. AI に関心がある一般読者にとって有益（ニッチすぎる学術論文単体は避ける）
4. 重複・類似トピックは最も情報量の多い1件に集約
5. 古いニュースの焼き直しや AI と関係が薄い記事は除外
6. **言語バランス必須**：{n_min}〜{n_max} 件中、**最低2件は [JP] 日本語ソース起点**を含める
7. 海外発の同じ話題が [JP][EN] 両方にある場合は **日本メディアの記事 URL を優先**

【マークアップ記法（重要）】
すべてのテキストフィールドで以下の **2種類のみ** 使えます。これらは UI 側で装飾されます。
- **太字**：重要なキーワード・固有名詞・サービス名・人名・組織名・注目すべき数値を `**...**` で囲む（太字で表示）。重要部分はすべて太字で対応する。
- !!注意・リスク!!：注意点・リスク・問題点・規制違反・セキュリティ懸念・著作権侵害・差別・倫理的問題・誤情報リスクなど、
  読者が**警戒すべきネガティブ情報**は `!!...!!` で囲む（赤太字で表示）。ポジティブな話題には絶対に使わない。
- 改行：長文は `\\n` で改行を入れて、1文を 40〜60字程度に収める。読みやすい呼吸を作る。
- 装飾は控えめに（**太字** 5〜10箇所、!!注意!! 0〜2箇所）。多用すると逆に読みにくい。

【!! 赤太字の使い方ルール】
- ❌ 絶対NG：title_ja・points・detail_summary など見出し系フィールドの**全体を !! で囲むこと**。
  全文が赤くなると視覚的に異質で読みにくい。**特定の単語・短いフレーズ1〜2箇所のみ**に使う。
- ✅ 良い例：「!!著作権侵害!! 疑惑で炎上、弁護士が法的リスクを解説」← 「著作権侵害」だけ赤太字
- ❌ 悪い例：「!!陸自の生成AIロゴが著作権侵害で炎上、弁護士が解説!!」← タイトル全体が赤
- 用途例：
  - 著作権訴訟で「!!無断学習!!」「!!著作権侵害!!」
  - 規制違反・罰金で「!!違反!!」「!!制裁金!!」
  - AI ハルシネーションで「!!幻覚（誤情報）!!」
  - セキュリティで「!!情報漏洩!!」「!!脆弱性!!」
- ※ 通常のニュースには無理に使わず、本当にリスク・警戒情報のときだけ

【書き方ルール（フィールド別）】
- title_ja：自然な日本語意訳。本文 25 字以内。中の重要キーワードを **太字** で囲む（1〜2箇所）。
  例：「**OpenAI**、AI スマホを **2027年** 発売へ」
- simple_explanation：小学校高学年でもわかる説明。専門用語は使わずたとえ話を活用。**太字** で重要部分を強調。
  100〜150字。改行を含めてOK。
- detail_summary：詳細セクションの先頭に出る濃い1文サマリー。**太字** を活用。50〜90字。
  例：「**GPT-5.5 Instant** は医療・法律分野で **52.5%** のハルシネーション削減を実現し、Memory Sources で透明性を強化」
- detail_points：詳細を構造化した箇条書き 4〜6 項目。各項目は `**見出し**：本文` 形式で書く。
  本文は 50〜100字、専門用語OK・**太字** を活用。固有名詞・数値・年月などを積極的に入れて密度を上げる。
  例：["**ハルシネーション削減**：医療・法律分野で従来比 **52.5%** の改善を達成", "**Memory Sources 機能**：過去のチャット・ファイル・Gmail から学習したコンテキストを可視化", ...]
- detail_text：detail_points の後ろに来る深掘り段落（読者は「もっと詳しく知りたい人」のみが読む前提）。
  背景・経緯・技術的な仕組み・業界文脈・今後の展望など、表に収まらない**ストーリー性のある説明**を 250〜400字。
  改行を入れて 2〜3 段落に。**太字** で要点を強調。専門用語は補足を付けつつ、密度高めで書いて良い。
- points：トップに出る重要ポイント3つ。各20〜40字、**太字** で要点を強調。「何が」「どれだけ」「なぜ」が立つ短文。
- before / after：30〜60字。**太字**で要点強調OK。
- impact：あなた（読者）への影響を1文。40〜80字。**太字** を活用。
- overview：今日全体の総括。120〜200字。**太字** で重要トピック名を強調。改行で2〜3文に。
- tip：title 15 字以内、content 80〜150字。content 内で **太字** を活用。実用的で具体的に。

【出力形式】
厳密な JSON のみを出力（コードフェンス不要）。

{{
  "date": "本日の日付（例: 2026年5月6日（火））",
  "overview": "本日全体の総括（**太字**含む 120〜200字）",
  "topics": [
    {{
      "category": "新モデル / 研究 / ビジネス / 規制 / ツール のいずれか",
      "title_ja": "**太字**を含む日本語タイトル",
      "simple_explanation": "**太字** と改行を含む説明（100〜150字）",
      "detail_summary": "**太字**を含む濃い1行サマリー（50〜90字）",
      "detail_points": [
        "**見出し1**：本文1（50〜100字）",
        "**見出し2**：本文2",
        "**見出し3**：本文3",
        "**見出し4**：本文4"
      ],
      "detail_text": "深掘り段落（250〜400字）。背景・経緯・仕組み・展望などを **太字** で要点強調しつつ 2〜3 段落で。",
      "points": ["**重要キーワード** を含む項目1", "...", "..."],
      "before": "これまではこうだった（30〜60字）",
      "after": "これからはこうなる（30〜60字）",
      "impact": "**太字**含むあなたへの影響（40〜80字）",
      "source": "ソース名（リストにあるもの）",
      "url": "記事URL（リストにあるものをそのまま）"
    }}
  ],
  "tip": {{
    "title": "Tips のタイトル（15字以内）",
    "content": "**太字** を含む Tips 本文（80〜150字）"
  }}
}}

重要度が高いものから順に並べてください。"""


def call_claude(items: list[dict]) -> dict:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    client = Anthropic(api_key=api_key)

    items_text = "\n\n".join(
        f"[{i+1}] [{(it.get('lang') or 'en').upper()}] ソース: {it['source']}\n"
        f"タイトル: {it['title']}\n"
        f"URL: {it['url']}\n"
        f"概要: {(it.get('summary') or '')[:500]}"
        for i, it in enumerate(items)
    )

    prompt = PROMPT_TEMPLATE.format(
        items=items_text,
        n_min=OUTPUT_ITEMS_MIN,
        n_max=OUTPUT_ITEMS_MAX,
    )

    response = client.messages.create(
        model=MODEL,
        max_tokens=16000,
        messages=[{"role": "user", "content": prompt}],
    )

    text = response.content[0].text.strip()
    # 万が一コードフェンスが付いていたら剥がす
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        print(f"[ERROR] JSON parse failed. Raw response:\n{text}", file=sys.stderr)
        raise


def main() -> int:
    print(f"[INFO] Fetching news at {datetime.now(JST).isoformat()}", file=sys.stderr)
    items = collect_all()
    print(f"[INFO] Total collected (after dedup): {len(items)} items", file=sys.stderr)

    if not items:
        print("[ERROR] No items collected. Aborting.", file=sys.stderr)
        return 1

    digest = call_claude(items)
    now_utc = datetime.now(timezone.utc)
    now_jst = now_utc.astimezone(JST)
    digest["generated_at_utc"] = now_utc.isoformat()
    digest["generated_at_jst"] = now_jst.strftime("%Y-%m-%d %H:%M JST")
    digest["source_count"] = len(items)
    digest.setdefault("topics", digest.pop("items", []))  # 旧 "items" キーがあった場合の互換

    data_dir = Path(__file__).resolve().parent.parent / "public" / "data"
    archive_dir = data_dir / "archive"
    data_dir.mkdir(parents=True, exist_ok=True)
    archive_dir.mkdir(parents=True, exist_ok=True)

    # 1. 最新版（digest.json）
    out_path = data_dir / "digest.json"
    out_path.write_text(json.dumps(digest, ensure_ascii=False, indent=2), encoding="utf-8")

    # 2. 履歴版（archive/YYYY-MM-DD.json）。同日上書き
    date_key = now_jst.strftime("%Y-%m-%d")
    archive_path = archive_dir / f"{date_key}.json"
    archive_path.write_text(json.dumps(digest, ensure_ascii=False, indent=2), encoding="utf-8")

    # 3. インデックス（archive/index.json）。古い順から最新順へ並べ、最新180日分を保持
    index_path = archive_dir / "index.json"
    try:
        index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"entries": []}
    except Exception:
        index = {"entries": []}

    entries = [e for e in index.get("entries", []) if e.get("date") != date_key]
    entries.append({
        "date": date_key,
        "date_label": digest.get("date", date_key),
        "overview": (digest.get("overview") or "")[:120],
        "topics_count": len(digest.get("topics", [])),
    })
    entries.sort(key=lambda e: e["date"], reverse=True)
    entries = entries[:180]
    index["entries"] = entries
    index["updated_at"] = now_jst.strftime("%Y-%m-%d %H:%M JST")
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[INFO] Wrote {len(digest.get('topics', []))} topics", file=sys.stderr)
    print(f"[INFO]   -> {out_path}", file=sys.stderr)
    print(f"[INFO]   -> {archive_path}", file=sys.stderr)
    print(f"[INFO]   -> {index_path} ({len(entries)} entries total)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
