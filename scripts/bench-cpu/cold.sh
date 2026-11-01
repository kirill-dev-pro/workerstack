#!/bin/zsh
# Fresh isolate per run: restart wrangler dev, then profile the first N
# requests of one route. Usage: cold.sh <label> <outdir> <repeat> "<METHOD path>"...
set -e
S=${0:A:h}
B=${BENCH_DIR:?set BENCH_DIR to the bench work directory}
# Stop only the wrangler this script started (and its workerd children).
kill_tree() { local c; for c in $(pgrep -P $1 2>/dev/null); do kill_tree $c; done; kill $1 2>/dev/null; }
stop_bench() {
  [[ -f $B/db/wrangler.pid ]] && kill_tree $(cat $B/db/wrangler.pid)
  rm -f $B/db/wrangler.pid
  for i in {1..40}; do lsof -ti tcp:8787 >/dev/null 2>&1 || break; sleep 0.25; done
}
APP=${APP:-$B/airealty}
label=$1; out=$2; repeat=$3; shift 3
stop_bench
sleep 1
cd $APP
nohup node_modules/.bin/wrangler dev -c dist/server/${CONFIG:-wrangler.json} --port 8787 --inspector-port 9230 --ip 127.0.0.1 > $B/db/wrangler.log 2>&1 &
echo $! > $B/db/wrangler.pid
for i in {1..120}; do curl -sf http://127.0.0.1:9230/json >/dev/null 2>&1 && grep -q "Ready on" $B/db/wrangler.log && break; sleep 0.5; done
sleep 2
reqs=()
for r in "$@"; do reqs+=(--req "$r"); done
bun $S/cdp-profile.ts "${reqs[@]}" --repeat $repeat --label $label --out $out
