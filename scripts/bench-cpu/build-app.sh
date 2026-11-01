#!/bin/zsh
# Build an airealty clone's worker and give it the bench env (dummy secrets, local sqld/sink).
set -e
APP=$1
S=${0:A:h}
B=${BENCH_DIR:?set BENCH_DIR to the bench work directory}
cd $APP
node_modules/.bin/workerstack wrangler >/dev/null
bun scripts/build-worker.ts > $B/db/build.log 2>&1
cp $B/db/dev.vars dist/server/.dev.vars
# Bench variant without the Scheduler binding: the fetch path alone.
python3 - dist/server/wrangler.json <<'PY'
import json,sys
p=sys.argv[1]; c=json.load(open(p))
c['durable_objects']['bindings']=[b for b in c['durable_objects']['bindings'] if b['name']!='SCHEDULER']
json.dump(c, open(p.replace('wrangler.json','wrangler.nosched.json'),'w'))
PY
echo built $APP
