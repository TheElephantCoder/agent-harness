#!/usr/bin/env bash
# grade.sh <task> — run inside the worktree. Prints details, exit 0 = pass.
set -uo pipefail
task="$1"
case "$task" in
  T1)
    # v2: file identity required (exact or src/-qualified), facts flexible phrasing.
    [ -f ANSWER.md ] || { echo "missing ANSWER.md"; exit 1; }
    A=$(tr '[:upper:]' '[:lower:]' < ANSWER.md)
    ok=1
    { echo "$A" | grep -qE "summarize\.ts" || { echo "$A" | grep -q "summarize" && echo "$A" | grep -qE "src/|cli"; }; } || { echo "missing: summarize impl file"; ok=0; }
    { echo "$A" | grep -qE "util\.ts" || { echo "$A" | grep -qE "(^|[^a-z])util([^a-z]|$)" && echo "$A" | grep -q "src/"; }; } || { echo "missing: util file"; ok=0; }
    echo "$A" | grep -qE "chars?:? ?11|character count[^0-9]*11|11[^0-9]{0,20}characters?|11[^0-9]{0,20}chars?" || { echo "missing: chars=11 fact"; ok=0; }
    echo "$A" | grep -qE "hi\(2\)|hi ?[:(=-] ?2|hi (appears|occurs|shows up) (twice|two times)|twice[^.]{0,20}hi" || { echo "missing: hi x2 fact"; ok=0; }
    [ "$ok" = 1 ] && echo "T1 PASS" || echo "T1 FAIL"
    exit $((1 - ok))
    ;;
  T2)
    npm test > /tmp/ab-grade-t2.txt 2>&1 || { echo "npm test failed"; tail -n 3 /tmp/ab-grade-t2.txt; exit 1; }
    out=$(printf 'hi hi' | npx tsx src/summarize.ts --json 2>/dev/null) || { echo "--json run failed"; exit 1; }
    node -e "
      const o = JSON.parse(process.argv[1]);
      if (o.words !== 2) throw new Error('words=' + o.words);
      if (!Array.isArray(o.top) || o.top[0][0] !== 'hi' || o.top[0][1] !== 2) throw new Error('top=' + JSON.stringify(o.top));
      for (const k of ['lines','words','chars','top']) if (!(k in o)) throw new Error('missing ' + k);
    " "$out" || exit 1
    def=$(printf 'hi hi' | npx tsx src/summarize.ts 2>/dev/null)
    [ "$def" = "$(printf 'lines: 1\nwords: 2\nchars: 5\ntop: hi(2)')" ] || { echo "default output changed:"; echo "$def"; exit 1; }
    echo "T2 PASS"
    ;;
  T3)
    npm test > /tmp/ab-grade-t3.txt 2>&1 || { echo "npm test failed"; tail -n 3 /tmp/ab-grade-t3.txt; exit 1; }
    chars=$(printf '👍👍 hi' | npx tsx src/summarize.ts 2>/dev/null | grep '^chars:' | awk '{print $2}')
    [ "$chars" = "5" ] || { echo "chars=$chars want 5"; exit 1; }
    echo "T3 PASS"
    ;;
esac
