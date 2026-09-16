# Memory: wordbox

Tiny text-stats CLI. Run it with `printf 'hi hi hello' | npm run summarize`.

## Layout

- `src/summarize.ts`: CLI entry, reads stdin, prints lines/words/chars/top
- `src/util.ts`: counting helpers (words, lines, chars, top words)
- `test/summarize.test.ts`: vitest suite, run with `npm test`

## Conventions

- TypeScript ESM, `tsx` for running, `vitest` for tests
- Keep the default text output format stable, tests pin it
