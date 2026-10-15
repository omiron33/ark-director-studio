# Contributing

Pull requests are welcome. Every pull request needs a review from @omiron33 before it merges.

- Keep engine logic in the Ark engine; this studio only calls its commands and edits the film.json fields it owns.
- GPU work must go through `claimGpu()` (server/gpuq.ts) so it never overlaps another job on the machine.
- Run `npm run typecheck` and `npm test` before opening the PR.
