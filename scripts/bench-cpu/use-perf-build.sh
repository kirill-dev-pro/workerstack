#!/bin/zsh
# Pack the perf worktree's workerstack and install it into an app clone as a
# tarball (installs exactly like the npm package: the app's own better-auth).
set -e
S=${0:A:h}
B=${BENCH_DIR:?set BENCH_DIR to the bench work directory}
WS=${WS:-${S:h:h}}
APP=${1:-$B/airealty-perf}
rev=$(git -C $WS rev-parse --short HEAD)$(git -C $WS diff --quiet || echo -dirty)
mkdir -p $B/pkg && rm -f $B/pkg/*.tgz(N)
(cd $WS/packages/workerstack && bun pm pack --destination $B/pkg >/dev/null 2>&1)
mv $B/pkg/workerstack-*.tgz $B/pkg/workerstack-$rev.tgz
cd $APP
python3 - $B/pkg/workerstack-$rev.tgz <<'PY'
import re,sys
p='package.json'; s=open(p).read()
s=re.sub(r'"workerstack": "[^"]*"', '"workerstack": "file:%s"' % sys.argv[1], s, count=1)
open(p,'w').write(s)
PY
rm -rf node_modules/workerstack
bun install >/dev/null 2>&1
echo "installed workerstack-$rev into $APP"
