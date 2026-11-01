#!/bin/zsh
# Fresh isolates → Scheduler alarms. For each of $K restarts of wrangler dev
# (full config, Scheduler bound) send one request, wait, and count the alarm
# and Scheduler fetch spans that local observability recorded.
S=${0:A:h}
B=${BENCH_DIR:?set BENCH_DIR to the bench work directory}
# Stop only the wrangler this script started (and its workerd children).
kill_tree() { local c; for c in $(pgrep -P $1 2>/dev/null); do kill_tree $c; done; kill $1 2>/dev/null; }
stop_bench() {
  [[ -f $B/db/wrangler.pid ]] && kill_tree $(cat $B/db/wrangler.pid)
  rm -f $B/db/wrangler.pid
  for i in {1..40}; do lsof -ti tcp:8787 >/dev/null 2>&1 || break; sleep 0.25; done
}
APP=$1; K=${K:-5}; WAIT=${WAIT:-5}
cd $APP
rm -rf .wrangler/state dist/server/.wrangler/state
total_alarms=0; total_fetch=0
for k in $(seq 1 $K); do
    nohup node_modules/.bin/wrangler dev -c dist/server/wrangler.json --port 8787 --inspector-port 9230 --ip 127.0.0.1 > $B/db/wrangler.log 2>&1 &
echo $! > $B/db/wrangler.pid
  for i in {1..120}; do curl -sf http://127.0.0.1:8787/api/health >/dev/null 2>&1 && break; sleep 0.5; done
  sleep $WAIT
  q() { curl -s -X POST http://127.0.0.1:8787/cdn-cgi/local/explorer/api/local/observability/query -H 'Content-Type: application/json' -d "{\"sql\":\"$1\"}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["rows"][0][0])'; }
  a=$(q "SELECT count(*) FROM spans WHERE parent_id IS NULL AND name = 'alarm'")
  f=$(q "SELECT count(*) FROM spans WHERE parent_id IS NULL AND name = 'POST'")
  echo "isolate $k: alarms=$a scheduler_posts=$f"
  curl -s -X POST http://127.0.0.1:8787/cdn-cgi/local/explorer/api/local/observability/clear >/dev/null
done
