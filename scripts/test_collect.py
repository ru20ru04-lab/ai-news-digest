"""収集部分だけのドライラン。API キーがなくても動く。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_news import collect_all

items = collect_all()
print(f"\n=== Collected {len(items)} items ===\n")
for it in items[:15]:
    print(f"[{it['source']}] {it['title'][:80]}")
    print(f"  {it['url']}")
print(f"\n... (total {len(items)})")
