#!/bin/zsh
# Cold first-request CPU, baseline clone vs perf clone. Runs alternate per
# route (base, perf, base, perf…) so outside load skews both alike.
#   BENCH_DIR=… CONFIG=wrangler.nosched.json RUNS=3 SERIES=3 compare.sh <tag>
S=${0:A:h}
B=${BENCH_DIR:?set BENCH_DIR to the bench work directory}
tag=$1; runs=${RUNS:-3}; series=${SERIES:-3}
while IFS= read -r route; do
  [[ -z $route ]] && continue
  slug=$(echo $route | cut -d' ' -f2 | tr -c 'a-zA-Z0-9\n' '_' | cut -c1-40)
  for run in $(seq 1 $runs); do
    for app in ${=APPS:-airealty airealty-perf}; do
      APP=$B/$app $S/cold.sh "$app-r$run" "$B/out/$tag/$app/$slug" $series "$route" |
        python3 -c '
import json,sys; d=json.load(sys.stdin)
for k,v in d["summary"].items(): print(json.dumps({"app":sys.argv[1],"route":k,"series":v["series"]}), flush=True)' $app
    done
  done
done < ${ROUTES:-$S/routes-core.txt}
