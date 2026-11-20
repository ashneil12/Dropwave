# PulseBilling release brief

Completed locally in the PulseBilling project at `/tmp/dropwave-sandbox-app`. Pricing commit: `4820c7bf3e1ec61d0c0acdadf2fa411c4fe23528`. Canonical release brief committed in `4fb0868` at `/tmp/dropwave-sandbox-app/.dropwave/docs/billing-release.md`.

`getProPrice('canary-39')` returns 39; default and other buckets return 29. Exported `annualPrice(monthly)` computes `monthly * 12 * 0.8`, rounded to two decimals.

Fresh verification by this server Atlas thread: `npm test` exited 0 on the integrated checkout, with tests 3, pass 3, fail 0, cancelled 0, skipped 0, todo 0. PulseBilling QA independently verified 3 passing tests and 13 additional pricing checks. The prior project-binding blocker is superseded by completed work in the correctly bound PulseBilling project.

Standing rule saved: always run `npm test` before closing any ask. All three original asks in this server thread are reconciled with the verified PulseBilling result. No production deployment performed.
