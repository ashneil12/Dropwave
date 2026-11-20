# Dropwave glass prototype

An isolated, frontend-only simulation of the approved Dropwave project loop. It uses fictional Hivra and Exo work, stores demo state in this browser only, and makes no agent, network, or live-data calls.

## Run

From this directory, run `python3 -m http.server 4173`, then open `http://localhost:4173`.

Build a self-contained copy with `node build-standalone.mjs /path/to/dropwave-glass.html`. That file can be opened directly in a browser.

Run the state and dialog-focus regression checks with `node --test *.test.mjs`.

## Demo path

1. Expand **Build and QA** in Hivra, inspect the builder and QA evidence, then collapse it.
2. Choose the recommended test-team rollout, the everyone option, or write a custom decision.
3. Switch to Exo, open its project notes, and try a sample run; stop it while it is running if desired.
4. Use **New project** to review a loop and definition of done before creating a project and running a sample.

**Demo only:** all people, work, events, decisions, and evidence are fictional.
