# dropwave-crew

Whether the Dropwave crew actually works end to end: a real T3 server on a fresh home,
a real provider CLI, a real repo per case. The eval plays the owner, drives the
conversation, and grades only durable state — asks, memories, personas, docs, bot
profiles, delegated jobs and lead file edits — never what the model claims.

## Run it

```bash
pnpm dropwave-crew --out runs/<name>
pnpm dropwave-crew --out runs/smoke --case question-is-answered-not-delegated
pnpm dropwave-crew --out runs/par --case parallel-workers-on-worker-model --samples 2
```

Flags: `--out <dir>` (required), `--case a,b`, `--samples <n>` (default 1),
`--provider <instanceId-substring>` (default: the codex instance), `--model
<slug-substring>` (default: the provider's default model), `--keep-homes` to keep the
temp T3 homes for debugging. Each case starts its own `t3 serve` on a fresh home (or a
shared home where the case says `shared:<name>`) and kills it by PID at the end. `runs/`
is gitignored.

Cost: every case drives real provider turns (worker jobs included). Expect several
minutes per case and real tokens; CI never runs this. `run.test.ts` tests the grader
over synthetic state and does run in CI.

## Cases

`cases.ts` is authored data: fixture files, owner turns, and the checks that grade the
outcome. A case's `experience`/`source` says which real bad experience it reproduces or
which good behavior it guards. Do not change case data or meaning; if a check misgrades
real behavior, fix the grader, not the case.

- `onboard-first-run` — fresh workspace: the Chief of Staff introduces itself, learns
  the owner, fills its identity card, writes the foundation doc, configures the loop and
  QA helper, and completes onboarding.
- `onboard-second-project-remembers-owner` — second project in the same home: same
  Atlas persona, greets Ash by name, project-scoped and owner-global memories land in
  the right scopes.
- `messy-dump-delegates-everything` — a scattered owner dump becomes four distinct asks,
  the two fixes get delegated and verified, the question is answered without a worker,
  the idea is parked, and the lead never edits the project itself.
- `routes-to-the-right-specialist` — SEO work goes to the SEO teammate.
- `question-is-answered-not-delegated` — control: a plain question spawns no worker.
- `parallel-workers-on-worker-model` — Track 3: three fixes fan out to parallel isolated
  worktree workers on the lead's configured worker model, all verified green.

## Shape

- `run.ts` spawns `apps/server/src/bin.ts serve --base-dir <home> --port <free>`, waits
  for `userdata/server-runtime.json`, issues a token, connects the typed WS RPC client,
  and drives turns via `orchestration.dispatchCommand`. Waits are event-driven off
  `orchestration.subscribeShell` — no sleeps or polling; a case times out at
  `timeoutMinutes` and still gets graded.
- Project setup calls `wireChiefOfStaff` / `configureDropwaveProject` from
  `@t3tools/client-runtime/dropwave-setup` — the same functions the web client's
  new-project sheet calls — so the eval exercises the real path.
- `grade.ts` holds the per-check grading over collected state; `run.test.ts` covers it
  with synthetic state (no model calls).
- Output: `results.jsonl` (one row per case × sample with every check + evidence) and
  `summary.md` (pass/fail table and failure evidence).
