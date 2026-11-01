#!/bin/zsh
# One-time setup of the cold-isolate CPU benchmark (see docs/performance-cpu.md).
#   BENCH_DIR=/tmp/ws-bench APP_REPO=~/Projects/…/airealty.global scripts/bench-cpu/setup.sh
# Creates two local clones of the app ($BENCH_DIR/airealty with its pinned
# workerstack, $BENCH_DIR/airealty-perf with this worktree's build), a local
# sqld with the app's migrations and synthetic rows, a telemetry/PostHog sink,
# and a bench env with random throwaway secrets. Nothing points at production.
set -e
S=${0:A:h}
B=${BENCH_DIR:?set BENCH_DIR to the bench work directory}
APP_REPO=${APP_REPO:?set APP_REPO to the app git repository}
SQLD=${SQLD:-$(ls -d ~/.cache/workerstack/sqld-*/*/sqld | head -1)}
mkdir -p $B/db $B/out
for name in airealty airealty-perf; do
  [[ -d $B/$name ]] || git clone --local --quiet $APP_REPO $B/$name
  (cd $B/$name && bun install >/dev/null 2>&1)
done
if ! curl -sf -X POST http://127.0.0.1:18080/v2/pipeline -d '{"requests":[]}' >/dev/null 2>&1; then
  nohup $SQLD --db-path $B/db/data.sqld --http-listen-addr 127.0.0.1:18080 > $B/db/sqld.log 2>&1 &
  sleep 2
fi
(cd $B/airealty && DATABASE_URL=http://127.0.0.1:18080 node_modules/.bin/drizzle-kit migrate >/dev/null)
bun $S/seed.ts http://127.0.0.1:18080
curl -sf http://127.0.0.1:18081 >/dev/null 2>&1 || (nohup bun $S/telemetry-sink.ts 18081 > $B/db/sink.log 2>&1 &)
if [[ ! -f $B/db/dev.vars ]]; then
  umask 077
  {
    echo "WORKERSTACK_DATABASE_URL=http://127.0.0.1:18080"
    echo "APP_URL=http://localhost:8787"
    echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
    echo "AUTH_SECRET=$(openssl rand -hex 32)"
    echo "STRIPE_SECRET_KEY=sk_test_bench_dummy"
    echo "BUNDERHOST_TELEMETRY_URL=http://127.0.0.1:18081"
    echo "BUNDERHOST_TELEMETRY_TOKEN=bench-dummy-token"
    echo "POSTHOG_HOST=http://127.0.0.1:18081"
  } > $B/db/dev.vars
fi
$S/use-perf-build.sh $B/airealty-perf
$S/build-app.sh $B/airealty
$S/build-app.sh $B/airealty-perf
echo "ready: BENCH_DIR=$B CONFIG=wrangler.nosched.json $S/compare.sh <tag>"
