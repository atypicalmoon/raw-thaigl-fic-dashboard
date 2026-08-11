import csv, json, math
from collections import defaultdict, Counter
from datetime import datetime
from pathlib import Path

WEBSITE = Path(__file__).resolve().parent.parent
SOURCE = WEBSITE / "articles_cleaned.csv"
OUTPUT = WEBSITE / "reports" / "cp-report-data.js"
EVENT_SOURCE = WEBSITE / "data" / "report_events.csv"
CUTOFF = "2026-08-10"

def number(value):
    try: return int(float(str(value or 0).replace(",", "")))
    except ValueError: return 0

def percentile(values, value):
    if len(values) < 2: return 100
    below = sum(v < value for v in values)
    equal = sum(v == value for v in values)
    return round(100 * (below + .5 * equal) / len(values))

rows_by_cp = defaultdict(list)
with SOURCE.open(encoding="utf-8-sig", newline="") as handle:
    for row in csv.DictReader(handle):
        cp = (row.get("cp") or "").strip()
        if not cp: continue
        try: date = datetime.strptime(row["publish_date"], "%Y-%m-%d")
        except (ValueError, TypeError): continue
        row.update({"date": date, "likes_n": number(row.get("likes")), "views_n": number(row.get("view_count")), "chapters_n": number(row.get("chapter_count")), "ended": str(row.get("is_end", "")).strip() in {"1", "true", "True"}})
        rows_by_cp[cp].append(row)

events = defaultdict(list)
if EVENT_SOURCE.exists():
    with EVENT_SOURCE.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            cp = (row.get("cp") or "").strip()
            if not cp: continue
            title_zh = (row.get("title_zh") or "").strip()
            title_original = (row.get("title_original") or "").strip()
            title = f"《{title_zh or title_original}》"
            events[cp].append({"type":(row.get("type") or "pre").strip(),"date":(row.get("date") or "").strip(),"title":title,"note":(row.get("note") or "").strip(),"sourceUrl":(row.get("source_url") or "").strip(),"verifiedOn":(row.get("verified_on") or "").strip()})

result = {}
for cp, rows in sorted(rows_by_cp.items()):
    rows.sort(key=lambda r: r["date"])
    years = Counter(str(r["date"].year) for r in rows)
    months = Counter(r["date"].strftime("%Y-%m") for r in rows)
    authors = defaultdict(list)
    for row in rows: authors[(row.get("author") or "未知作者").strip()].append(row)
    author_rows = []
    for name, items in authors.items():
        if len(items) < 2: continue
        representative = sorted(items, key=lambda x:(x["likes_n"] + x["views_n"] / 500), reverse=True)[:2]
        author_rows.append({"name":name,"works":len(items),"avgLikes":round(sum(x["likes_n"] for x in items)/len(items)),"avgViews":round(sum(x["views_n"] for x in items)/len(items)),"representativeWorks":[{"title":x.get("title") or "未命名作品","url":x.get("link") or "#"} for x in representative]})
    if author_rows:
        work_vals=[a["works"] for a in author_rows]; like_vals=[a["avgLikes"] for a in author_rows]; view_vals=[a["avgViews"] for a in author_rows]
        for a in author_rows:
            a["scores"]=[percentile(work_vals,a["works"]),percentile(like_vals,a["avgLikes"]),percentile(view_vals,a["avgViews"])]
            a["score"]=sum(sorted(a["scores"], reverse=True)[:2]) + sum(a["scores"])/20
        author_rows=sorted(author_rows,key=lambda a:a["score"],reverse=True)[:4]
        for a in author_rows: a.pop("score",None)
    picked=[]
    candidates=[("点赞最高",max(rows,key=lambda r:r["likes_n"])),("阅读最高",max(rows,key=lambda r:r["views_n"]))]
    for label,row in candidates:
        existing=next((x for x in picked if x["url"]==row.get("link")),None)
        if existing: existing["label"] += " · " + label
        else: picked.append({"label":label,"title":row.get("title") or "未命名作品","author":row.get("author") or "未知作者","date":row["date"].strftime("%Y-%m-%d"),"likes":row["likes_n"],"views":row["views_n"],"chapters":row["chapters_n"],"ended":row["ended"],"url":row.get("link") or "#"})
    for row in sorted(rows,key=lambda r:(r["likes_n"]+r["views_n"]/500),reverse=True):
        if len(picked)>=4: break
        if not any(x["url"]==row.get("link") for x in picked):
            picked.append({"label":"高反馈作品","title":row.get("title") or "未命名作品","author":row.get("author") or "未知作者","date":row["date"].strftime("%Y-%m-%d"),"likes":row["likes_n"],"views":row["views_n"],"chapters":row["chapters_n"],"ended":row["ended"],"url":row.get("link") or "#"})
    cp_events=events.get(cp,[])
    result[cp]={"cp":cp,"start":rows[0]["date"].strftime("%Y-%m-%d"),"end":CUTOFF,"total":len(rows),"authors":len(authors),"currentYear":sum(v for k,v in months.items() if k.startswith("2026-")),"activeMonths":len(months),"ended":sum(r["ended"] for r in rows),"years":dict(sorted(years.items())),"months":dict(sorted(months.items())),"works":picked,"authorCards":author_rows,"events":cp_events,"eventStatus":"已整理可核实节点" if cp_events else "暂未检索到可核实的合作剧节点"}

OUTPUT.write_text("window.CP_REPORT_DATA=" + json.dumps(result,ensure_ascii=False,separators=(",",":")) + ";\n",encoding="utf-8")
print(f"Wrote {len(result)} CP reports to {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")
