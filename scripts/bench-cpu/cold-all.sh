#!/bin/zsh
# Every route of routes.txt as the first request of a fresh isolate, $RUNS times,
# with $SERIES requests per isolate. Usage: cold-all.sh <label> <outdir>
S=${0:A:h}
B=${BENCH_DIR:?set BENCH_DIR to the bench work directory}
label=$1; out=$2; runs=${RUNS:-3}; series=${SERIES:-5}
while IFS= read -r route; do
  [[ -z $route ]] && continue
  for run in $(seq 1 $runs); do
    $S/cold.sh "$label-r$run" "$out/$(echo $route | cut -d' ' -f2 | tr -c 'a-zA-Z0-9\n' '_' | cut -c1-40)" $series "$route" | python3 -c '
import json,sys; d=json.load(sys.stdin)
for k,v in d["summary"].items(): print(json.dumps({"route":k,"series":v["series"]}))'
  done
done < ${ROUTES:-$S/routes.txt}
