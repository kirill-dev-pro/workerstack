# Summarise compare.sh output: median first-request CPU and median of the
# later (warm) requests per route and build.   python3 summarize.py out.jsonl
import json, sys, statistics as st
rows = {}
for line in open(sys.argv[1]):
    line = line.strip()
    if not line.startswith('{'): continue
    d = json.loads(line)
    r = rows.setdefault(d['route'].split(' [')[0], {}).setdefault(d['app'], {'cold': [], 'warm': [], 'status': d['route'].split(' [')[-1].rstrip(']')})
    r['cold'].append(d['series'][0]); r['warm'] += d['series'][1:]
print('| route | base cold | perf cold | Δ | base warm | perf warm |')
print('|---|---|---|---|---|---|')
for route, apps in rows.items():
    b, p = apps.get('airealty'), apps.get('airealty-perf')
    if not b or not p: continue
    bc, pc = st.median(b['cold']), st.median(p['cold'])
    print(f"| `{route[:60]}` | {bc:.1f} | {pc:.1f} | {100*(pc-bc)/bc:+.0f}% | {st.median(b['warm']):.1f} | {st.median(p['warm']):.1f} |")
