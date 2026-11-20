# PulseBilling release brief

Status: blocked before implementation; not released.

Requested fix: Pro bucket `canary-39` returns 39; default stays 29. Add exported `annualPrice(monthly)` using `monthly * 12 * 0.8`, rounded to two decimals.

Source: `/tmp/dropwave-sandbox-app`. Atlas is bound to the T3 server project instead. T3 rejected isolated delegation to PulseBilling twice: `A local task runs in this thread's project.` Owner clarification is pending to create a PulseBilling thread or allow direct implementation. No pricing changes made.

Baseline verification on 2026-11-20: `npm test` (`node --test`) exited 1. Tests: 1; pass: 0; fail: 1; cancelled/skipped/todo: 0. Test loading fails because `src/pricing.js` does not export `annualPrice`. Current `getProPrice` always returns 29. Independent server QA baseline check requested.

All three tracked asks remain open, with blocker recorded. The standing rule to run `npm test` before closing any ask is saved in Dropwave memory. No zero-failure or release claim is made.
