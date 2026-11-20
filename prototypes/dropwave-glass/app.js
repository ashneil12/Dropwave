import { restoreState, serializeState } from "./state-storage.js";
import { focusTrapTarget } from "./dialog-focus.js";

const STORAGE_KEY = "dropwave-glass-prototype-v1";

const makeSeed = () => ({
  activeProjectId: "hivra",
  projects: [
    {
      id: "hivra",
      name: "Hivra",
      tagline: "A calm workspace for turning decisions into shipped work.",
      color: "#a5ecd9",
      loop: [
        "Lead shapes the work",
        "Builder makes the change",
        "Independent QA checks it",
        "Lead returns evidence",
      ],
      definition:
        "A change is ready when its owner is clear, QA has independently accepted it, and the lead has posted concise evidence in the project conversation.",
      sampleGoal: "Make a product decision visible without pausing the whole project.",
      custom: false,
    },
    {
      id: "exo",
      name: "Exo",
      tagline: "A smaller loop: the project lead handles the work directly.",
      color: "#ffc19f",
      loop: [
        "Lead clarifies the goal",
        "Lead makes the change",
        "Lead checks the result",
        "Evidence stays in the conversation",
      ],
      definition:
        "The lead owns the change from clarification through acceptance and leaves one short evidence note when it is done.",
      sampleGoal: "Keep a small product update moving without a separate worker handoff.",
      custom: false,
    },
  ],
  workers: [
    { id: "worker-lead-hivra", name: "Nia Park", role: "Project lead", projectId: "hivra" },
    { id: "worker-builder-hivra", name: "Sora Lin", role: "Builder", projectId: "hivra" },
    { id: "worker-qa-hivra", name: "Milo Reed", role: "QA", projectId: "hivra" },
    { id: "worker-lead-exo", name: "Eli Rowan", role: "Project lead", projectId: "exo" },
  ],
  workItems: [
    {
      id: "work-permissions",
      projectId: "hivra",
      title: "Workspace access controls",
      status: "accepted",
      runId: "run-001",
    },
    {
      id: "work-rollout-choice",
      projectId: "hivra",
      title: "Rollout audience",
      status: "decision-needed",
      runId: "run-002",
      decisionId: "decision-rollout",
    },
    {
      id: "work-notes-ui",
      projectId: "hivra",
      title: "Decision panel spacing",
      status: "fix-returned",
      runId: "run-003",
    },
  ],
  runs: [
    {
      id: "run-001",
      projectId: "hivra",
      workItemId: "work-permissions",
      number: 1,
      status: "accepted",
      title: "Access checks aligned",
      summary:
        "A clean first loop: the builder shipped, QA accepted, and the lead posted the result.",
      events: [
        {
          id: "evt-001a",
          workerId: "worker-lead-hivra",
          label: "Scoped the access change",
          detail: "The lead kept the work to one permission boundary and set a clear done check.",
          status: "done",
        },
        {
          id: "evt-001b",
          workerId: "worker-builder-hivra",
          label: "Updated workspace access",
          detail: "The builder finished the change and shared a small evidence bundle.",
          status: "done",
        },
        {
          id: "evt-001c",
          workerId: "worker-qa-hivra",
          label: "Accepted the result",
          detail: "Independent QA confirmed the allowed and blocked paths.",
          status: "passed",
        },
      ],
      evidenceId: "evidence-run-001",
    },
    {
      id: "run-002",
      projectId: "hivra",
      workItemId: "work-rollout-choice",
      number: 2,
      status: "decision-needed",
      title: "Rollout audience",
      summary:
        "The implementation is ready; the lead paused for a product choice instead of assuming the policy.",
      events: [
        {
          id: "evt-002a",
          workerId: "worker-lead-hivra",
          label: "Prepared the rollout",
          detail: "The lead gathered the trade-off and chose a cautious recommendation.",
          status: "done",
        },
        {
          id: "evt-002b",
          workerId: "worker-builder-hivra",
          label: "Built the audience control",
          detail: "The control is ready to exercise with either rollout option.",
          status: "done",
        },
        {
          id: "evt-002c",
          workerId: "worker-qa-hivra",
          label: "Checked both paths",
          detail: "QA confirmed both options can be recorded without changing a standing rule.",
          status: "passed",
        },
      ],
      evidenceId: null,
    },
    {
      id: "run-003",
      projectId: "hivra",
      workItemId: "work-notes-ui",
      number: 3,
      status: "fix-returned",
      title: "Decision panel spacing",
      summary:
        "QA found a narrow-screen issue. The lead returned it to the builder; the latest fix is ready for independent re-check.",
      events: [
        {
          id: "evt-003a",
          workerId: "worker-lead-hivra",
          label: "Assigned the decision panel",
          detail: "The lead gave the builder one responsive layout acceptance check.",
          status: "done",
        },
        {
          id: "evt-003b",
          workerId: "worker-builder-hivra",
          label: "Built the first pass",
          detail: "The decision controls were ready for independent QA.",
          status: "done",
        },
        {
          id: "evt-003c",
          workerId: "worker-qa-hivra",
          label: "Found a narrow-screen issue",
          detail:
            "At phone width, the two choice buttons competed for space and one label wrapped awkwardly.",
          status: "failed",
        },
        {
          id: "evt-003d",
          workerId: "worker-lead-hivra",
          label: "Returned it to the builder",
          detail:
            "The lead sent the specific failure back rather than treating builder completion as QA acceptance.",
          status: "done",
        },
        {
          id: "evt-003e",
          workerId: "worker-builder-hivra",
          label: "Adjusted the responsive layout",
          detail: "The latest fix is ready; QA acceptance is still a separate step.",
          status: "pending",
        },
      ],
      evidenceId: "evidence-run-003",
    },
  ],
  decisions: [
    {
      id: "decision-rollout",
      projectId: "hivra",
      runId: "run-002",
      status: "pending",
      question: "Should this be available to everyone or just your test team?",
      context:
        "The change is ready to try. Starting with a test team keeps the rollout reversible while you learn from the first few runs.",
      recommendation: "test-team",
      options: [
        {
          id: "test-team",
          title: "Test team first",
          note: "Start small, then widen the rollout with evidence.",
        },
        { id: "everyone", title: "Everyone", note: "Make it available across the project now." },
      ],
      answer: null,
      evidenceId: null,
    },
  ],
  evidence: [
    {
      id: "evidence-run-001",
      projectId: "hivra",
      runId: "run-001",
      title: "Access checks accepted",
      status: "QA accepted",
      detail: "Allowed and blocked access paths both matched the project definition of done.",
    },
    {
      id: "evidence-run-003",
      projectId: "hivra",
      runId: "run-003",
      title: "Phone-width issue returned",
      status: "Fix returned · QA re-check pending",
      detail:
        "Independent QA found that the rollout choices competed for space on a phone-width screen. The lead returned that specific issue to the builder, whose layout adjustment is still awaiting a separate QA re-check.",
    },
  ],
  messages: [
    {
      id: "msg-hivra-intro",
      projectId: "hivra",
      role: "lead",
      text: "The rollout control is ready, and the latest decision-panel fix is back from the builder. QA caught a phone-width issue in the earlier pass, so I returned it with the exact failure instead of calling the build accepted. One product choice is still yours.",
      time: "just now",
    },
    {
      id: "msg-exo-intro",
      projectId: "exo",
      role: "lead",
      text: "I can keep this one simple: I’ll shape the change, check it, and leave the evidence here. No extra worker handoff is needed for this project.",
      time: "just now",
    },
  ],
  selectedRunId: null,
  expandedActivity: false,
  modal: null,
  toast: "",
  nextId: 1,
});

let state = readSavedState();
let simulationTimer = null;
let toastTimer = null;
let modalOpener = null;

function readSavedState() {
  try {
    return restoreState(localStorage.getItem(STORAGE_KEY), makeSeed);
  } catch {
    return makeSeed();
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, serializeState(state));
  } catch {
    /* The demo still works when storage is unavailable. */
  }
}

function currentProject() {
  return (
    state.projects.find((project) => project.id === state.activeProjectId) ?? state.projects[0]
  );
}
function pendingDecision(projectId) {
  return state.decisions.find(
    (decision) => decision.projectId === projectId && decision.status === "pending",
  );
}
function worker(workerId) {
  return state.workers.find((item) => item.id === workerId);
}
function runFor(runId) {
  return state.runs.find((item) => item.id === runId);
}
function currentSimulation(projectId) {
  return state.runs.find((run) => run.projectId === projectId && run.status === "running");
}
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}
function icon(name) {
  const icons = {
    wave: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 14.5c2.2 0 2.2-5 4.5-5s2.3 5 4.5 5 2.2-5 4.5-5 2.3 5 4.5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4 18.5h16" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".65"/></svg>',
    activity:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h5v5H4zM15 12h5v5h-5zM9 9.5h4a2 2 0 0 1 2 2V14" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 12v4a2 2 0 0 0 2 2h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    sparkle:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" fill="currentColor"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.4 4.4L19 7.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevron:
      '<svg class="chevron" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    notes:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3.8h8l4 4V20H6z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M14 4v4h4M9 12h6M9 15.5h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    arrow:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  return icons[name] ?? "";
}

function renderProjectButton(project) {
  const waiting = state.decisions.filter(
    (decision) => decision.projectId === project.id && decision.status === "pending",
  ).length;
  return `<button class="project-button" data-action="switch-project" data-project="${escapeHtml(project.id)}" aria-current="${project.id === state.activeProjectId ? "page" : "false"}" style="--project-accent:${escapeHtml(project.color)}"><span class="project-dot"></span><span class="project-copy"><span class="project-name">${escapeHtml(project.name)}</span><span class="project-sub">${project.custom ? "New project" : project.id === "exo" ? "Lead-owned loop" : "Build + independent QA"}</span></span>${waiting ? `<span class="wait-count" aria-label="${waiting} decision waiting">${waiting}</span>` : ""}</button>`;
}

function renderRail() {
  return `<aside class="rail" aria-label="Workspace and projects"><div class="brand-row"><div class="brand-mark" aria-hidden="true">${icon("wave")}</div><div><div class="brand-name">Dropwave</div><div class="brand-caption">Work, in motion</div></div></div><div class="rail-section-label">Your workspace</div><div class="project-list">${state.projects.map(renderProjectButton).join("")}</div><button class="new-project-button" data-action="new-project"><span class="plus-icon">+</span> Start a blank project</button><div class="rail-spacer"></div><div class="demo-status"><div class="demo-status-top"><span class="status-pulse"></span> Local demo space</div><p>Fictional work only. No agents, credentials, or live project data are connected.</p></div><div class="rail-footer"><span>Prototype · v0.1</span><button class="text-button" data-action="reset-demo">Reset demo</button></div></aside>`;
}

function renderTopbar(project) {
  return `<header class="topbar"><div class="crumbs"><span>Workspace</span><span class="crumb-separator">/</span><span class="crumb-project">${escapeHtml(project.name)}</span></div><select class="mobile-project-select" aria-label="Switch project" data-action="mobile-switch">${state.projects.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === project.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select><div class="topbar-actions"><span class="sim-label">${icon("sparkle")} Simulated work</span><button class="icon-button" aria-label="Open project notes" data-action="open-notes" data-focus-key="topbar-notes">${icon("notes")}</button></div></header>`;
}

function renderTitle(project) {
  const waiting = pendingDecision(project.id);
  return `<section class="conversation-header"><div class="project-title-wrap"><div class="eyebrow">Project conversation</div><h1>${escapeHtml(project.name)}</h1><p class="project-description">${escapeHtml(project.tagline)}</p></div><span class="header-pill"><span class="pill-dot" style="background:${waiting ? "var(--gold)" : "var(--mint)"}"></span>${waiting ? "Decision waiting" : "Lead is on it"}</span></section>`;
}

function renderMessage(message) {
  const lead = message.role === "lead";
  return `<article class="${lead ? "lead-message" : "user-message"}"><div class="avatar ${lead ? "" : "user-avatar"}" aria-hidden="true">${lead ? "N" : "A"}</div><div class="message-body"><div class="message-meta"><span class="message-author">${lead ? "Nia · project lead" : "You"}</span><span class="message-time">${escapeHtml(message.time ?? "just now")}</span></div><p class="${lead ? "lead-copy" : "user-bubble"}">${escapeHtml(message.text)}</p>${message.evidenceLink ? `<button class="inline-link" data-action="show-evidence" data-evidence="${escapeHtml(message.evidenceLink)}">${icon("check")} View recorded evidence</button>` : ""}</div></article>`;
}

function renderActivityDetails(project) {
  const selectedRun = runFor(state.selectedRunId);
  const run = selectedRun?.projectId === project.id ? selectedRun : runFor("run-003");
  if (!run) return "";
  return `<div class="activity-details" id="build-qa-details" ${state.expandedActivity ? "" : "hidden"}><p class="activity-intro">${escapeHtml(run.summary)}</p><div class="timeline">${run.events
    .map((event) => {
      const owner = worker(event.workerId);
      const statusClass =
        event.status === "failed" ? "failed" : event.status === "pending" ? "pending" : "";
      const statusText =
        event.status === "failed"
          ? "QA failed"
          : event.status === "pending"
            ? "Re-check pending"
            : event.status === "passed"
              ? "Accepted"
              : event.status === "stopped"
                ? "Stopped"
                : "Done";
      return `<div class="timeline-event"><span class="timeline-mark ${statusClass}"></span><div><div class="timeline-meta"><span class="timeline-name">${escapeHtml(owner?.name ?? "Project lead")}</span><span class="timeline-role">${escapeHtml(owner?.role ?? "Lead")}</span><span class="status-word ${statusClass}">${statusText}</span></div><p class="timeline-copy"><strong>${escapeHtml(event.label)}.</strong> ${escapeHtml(event.detail)}</p></div></div>`;
    })
    .join(
      "",
    )}</div><div class="activity-footer"><span>Run ${String(run.number).padStart(2, "0")} · ${run.status === "accepted" ? "complete" : run.status === "decision-needed" ? "decision open" : run.status === "fix-returned" ? "returned to builder" : run.status}</span><button data-action="show-run-evidence" data-run="${escapeHtml(run.id)}">${run.evidenceId ? "Open evidence" : "Run details"} ${icon("arrow")}</button></div></div>`;
}

function renderActivityCard(project) {
  if (project.id !== "hivra") return "";
  const expanded = state.expandedActivity;
  const selectedRun = runFor(state.selectedRunId);
  const run = selectedRun?.projectId === project.id ? selectedRun : runFor("run-003");
  const status =
    run?.status === "accepted"
      ? "QA accepted"
      : run?.status === "decision-needed"
        ? "Decision needed"
        : "Returned to builder";
  return `<section class="activity-card"><button class="activity-toggle" data-action="toggle-activity" aria-expanded="${expanded}" aria-controls="build-qa-details"><span class="activity-icon">${icon("activity")}</span><span class="activity-heading"><span class="activity-title-row"><span class="activity-title">Build and QA</span></span><span class="activity-subtitle">${escapeHtml(run?.summary ?? "Inspect the latest work and evidence.")}</span></span><span class="activity-status">${status}</span>${icon("chevron")}</button>${renderActivityDetails(project)}</section>`;
}

function renderDecision(project) {
  const decision = pendingDecision(project.id);
  if (!decision) return "";
  return `<section class="decision-card" aria-labelledby="decision-question"><div class="decision-kicker">${icon("sparkle")} A choice for you</div><h2 class="decision-question" id="decision-question">${escapeHtml(decision.question)}</h2><p class="decision-context">${escapeHtml(decision.context)}</p><div class="decision-options">${decision.options.map((option) => `<button class="option-button ${option.id === decision.recommendation ? "recommended" : ""}" data-action="answer-decision" data-decision="${escapeHtml(decision.id)}" data-option="${escapeHtml(option.id)}"><span class="option-title">${option.id === decision.recommendation ? icon("check") : ""}${escapeHtml(option.title)}</span><span class="option-note">${escapeHtml(option.note)}</span>${option.id === decision.recommendation ? `<span class="recommendation-tag">Recommended · ${escapeHtml(option.id === "test-team" ? "lower risk" : "faster reach")}</span>` : ""}</button>`).join("")}</div><div class="or-divider">or write your own</div><form class="custom-answer" data-form="custom-answer" data-decision="${escapeHtml(decision.id)}"><label class="sr-only" for="custom-answer-input">Write a different answer</label><input id="custom-answer-input" name="answer" maxlength="180" placeholder="Type a different answer…" /><button class="button-subtle" type="submit">Record answer</button></form></section>`;
}

function renderRecordedDecision(project) {
  const decision = state.decisions.find(
    (item) => item.projectId === project.id && item.status === "answered",
  );
  if (!decision) return "";
  const evidence = state.evidence.find((item) => item.id === decision.evidenceId);
  return `<div class="decision-recorded"><strong>Decision recorded:</strong> ${escapeHtml(decision.answer)} <span aria-hidden="true">·</span> ${escapeHtml(evidence?.status ?? "local simulation")}</div>${evidence ? `<section class="evidence-card"><div class="evidence-head"><div class="evidence-title">${icon("check")} ${escapeHtml(evidence.title)}</div><span class="evidence-badge">Evidence</span></div><p class="evidence-copy">${escapeHtml(evidence.detail)}</p><div class="evidence-grid"><div class="evidence-stat"><span class="evidence-stat-label">Recorded choice</span><span class="evidence-stat-value">${escapeHtml(decision.answer)}</span></div><div class="evidence-stat"><span class="evidence-stat-label">Scope</span><span class="evidence-stat-value">This simulated run only</span></div></div></section>` : ""}`;
}

function renderExoActivity(project) {
  const selectedRun = runFor(state.selectedRunId);
  const run =
    selectedRun?.projectId === project.id
      ? selectedRun
      : state.runs
          .filter((item) => item.projectId === project.id)
          .reduce((latest, item) => (!latest || item.number > latest.number ? item : latest), null);
  if (!run) return "";
  const status =
    run.status === "accepted"
      ? "Accepted"
      : run.status === "running"
        ? "In progress"
        : run.status === "stopped"
          ? "Stopped"
          : "Simple flow";
  return `<section class="activity-card"><button class="activity-toggle" data-action="toggle-activity" aria-expanded="${state.expandedActivity}" aria-controls="build-qa-details"><span class="activity-icon">${icon("activity")}</span><span class="activity-heading"><span class="activity-title-row"><span class="activity-title">${project.custom ? "Project loop" : "Lead-owned loop"}</span></span><span class="activity-subtitle">One owner · no worker handoff</span></span><span class="activity-status" style="border-color:rgb(165 236 217 / 20%);background:rgb(165 236 217 / 7%);color:var(--mint)">${status}</span>${icon("chevron")}</button><div class="activity-details" id="build-qa-details" ${state.expandedActivity ? "" : "hidden"}><p class="activity-intro">${escapeHtml(run.summary)}</p><div class="timeline">${run.events.map((event) => `<div class="timeline-event"><span class="timeline-mark ${event.status === "stopped" ? "failed" : ""}"></span><div><div class="timeline-meta"><span class="timeline-name">${escapeHtml(worker(event.workerId)?.name ?? "Eli Rowan")}</span><span class="timeline-role">Project lead</span><span class="status-word ${event.status === "stopped" ? "failed" : ""}">${escapeHtml(event.status === "passed" ? "Accepted" : event.status === "stopped" ? "Stopped" : event.status === "pending" ? "In progress" : "Done")}</span></div><p class="timeline-copy">${escapeHtml(event.detail)}</p></div></div>`).join("")}</div></div></section>`;
}

function renderHistory(project) {
  if (project.id !== "hivra") return "";
  return `<div class="history-heading">Earlier in this project</div>${state.runs
    .filter((run) => run.projectId === project.id)
    .slice(0, 2)
    .map(
      (run) =>
        `<button class="history-run" data-action="inspect-run" data-run="${escapeHtml(run.id)}"><span class="history-icon">${run.number === 1 ? icon("check") : "◇"}</span><span class="history-copy"><span class="history-title">Run ${run.number}: ${escapeHtml(run.title)}</span><span class="history-sub">${escapeHtml(run.summary)}</span></span><span class="history-result">${run.status === "accepted" ? "Accepted" : run.status === "decision-needed" ? (pendingDecision(project.id) ? "Choice waiting" : "Recorded") : "Returned"}</span></button>`,
    )
    .join("")}`;
}

function renderSimulation(project) {
  const run = currentSimulation(project.id);
  if (!run) return "";
  return `<div class="sample-run-state" role="status"><span class="running-dot"></span> ${escapeHtml(run.title)} · simulated locally</div>`;
}

function renderComposer(project) {
  const running = currentSimulation(project.id);
  return `<div class="composer-wrap"><form class="composer" data-form="chat"><label class="sr-only" for="composer-input">Message the project lead</label><textarea id="composer-input" name="message" rows="2" maxlength="600" placeholder="Share an idea or ask the project lead…"></textarea><div class="composer-actions"><span class="composer-hint">Your message stays in this local demo.</span><div class="composer-buttons">${running ? `<button class="button-danger" type="button" data-action="stop-run">Stop run</button>` : `<button class="button-subtle" type="button" data-action="start-run">${project.custom ? "Try sample run" : "Run sample"}</button>`}<button class="button-primary" type="submit">Send ${icon("arrow")}</button></div></div></form></div>`;
}

function renderNotes(project) {
  return `<aside class="notes-column"><section class="notes-card"><div class="notes-title-row"><span class="notes-title">Project notes</span><span class="notes-icon">${icon("notes")}</span></div><p class="notes-copy">${escapeHtml(project.sampleGoal)}</p><div class="notes-divider"></div><div class="notes-label">The current loop</div>${project.loop.map((step, index) => `<div class="loop-step"><span class="loop-number">${index + 1}</span><span>${escapeHtml(step)}</span></div>`).join("")}<div class="notes-divider"></div><div class="notes-label">Definition of done</div><p class="notes-copy">${escapeHtml(project.definition)}</p><div class="notes-footer"><button data-action="open-notes" data-focus-key="notes-footer">Open full notes ${icon("arrow")}</button><div class="notes-footnote">A project can change its loop any time. No org chart required.</div></div></section></aside>`;
}

function renderNotesModal(project) {
  if (state.modal?.type === "loop-editor") {
    return `<div class="modal-backdrop" data-action="close-modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><div class="eyebrow">${escapeHtml(project.name)} · project notes</div><h2 class="modal-title" id="modal-title">Change the project loop</h2></div><button class="icon-button modal-close" data-action="close-modal" aria-label="Close editor">×</button></div><p class="modal-copy">Keep the loop small. These changes stay in this browser and can be reset with the demo.</p><form data-form="edit-loop"><div class="loop-editor-fields">${project.loop.map((step, index) => `<div class="form-field"><label for="loop-step-${index}">Step ${index + 1}</label><input id="loop-step-${index}" name="step-${index}" maxlength="100" required value="${escapeHtml(step)}" /></div>`).join("")}<div class="form-field"><label for="loop-definition">Definition of done</label><textarea id="loop-definition" name="definition" maxlength="300" required>${escapeHtml(project.definition)}</textarea></div></div><div class="modal-actions"><button type="button" class="button-subtle" data-action="close-modal">Cancel</button><button class="button-primary" type="submit">Save this loop</button></div></form></section></div>`;
  }
  if (state.modal?.type !== "notes") return "";
  return `<div class="modal-backdrop" data-action="close-modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><div class="eyebrow">${escapeHtml(project.name)} · project notes</div><h2 class="modal-title" id="modal-title">How this project works</h2></div><button class="icon-button modal-close" data-action="close-modal" aria-label="Close notes">×</button></div><p class="modal-copy">${escapeHtml(project.sampleGoal)}</p><div class="proposal-list">${project.loop.map((step, index) => `<div class="proposal-step"><span class="loop-number">${index + 1}</span><span>${escapeHtml(step)}</span></div>`).join("")}</div><div class="definition-card"><div class="notes-label">Definition of done</div><p>${escapeHtml(project.definition)}</p></div><div class="modal-actions"><button class="button-subtle" data-action="change-loop">Change this loop</button><button class="button-primary" data-action="close-modal">Done</button></div></section></div>`;
}

function renderOnboarding() {
  if (!state.modal || !state.modal.type.startsWith("new-project")) return "";
  if (state.modal.type === "new-project-form") {
    return `<div class="modal-backdrop" data-action="close-modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><div class="eyebrow">A fresh start</div><h2 class="modal-title" id="modal-title">What are you building?</h2></div><button class="icon-button modal-close" data-action="close-modal" aria-label="Close">×</button></div><p class="modal-copy">Start with what the project ships. The lead will suggest a small loop and a definition of done for you to review.</p><form data-form="new-project"><div class="form-field"><label for="new-project-name">Project name</label><input id="new-project-name" name="name" required maxlength="36" placeholder="e.g. Atlas" /></div><div class="form-field"><label for="new-project-goal">What does this project ship?</label><textarea id="new-project-goal" name="goal" required maxlength="300" placeholder="A clear outcome is enough to begin…"></textarea><span class="field-help">This is saved only in this browser.</span></div><div class="modal-actions"><button type="button" class="button-subtle" data-action="close-modal">Cancel</button><button class="button-primary" type="submit">Review the proposed loop ${icon("arrow")}</button></div></form></section></div>`;
  }
  const draft = state.modal.draft;
  const loop = [
    "Lead turns the goal into a small first step",
    "A builder makes one focused change",
    "The lead checks it against your goal",
    "The result and any decision stay in this conversation",
  ];
  return `<div class="modal-backdrop" data-action="close-modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><div class="eyebrow">Review before starting</div><h2 class="modal-title" id="modal-title">${escapeHtml(draft.name)}’s first loop</h2></div><button class="icon-button modal-close" data-action="close-modal" aria-label="Close">×</button></div><p class="modal-copy">Goal: “${escapeHtml(draft.goal)}”</p><div class="proposal-list">${loop.map((step, index) => `<div class="proposal-step"><span class="loop-number">${index + 1}</span><span>${escapeHtml(step)}</span></div>`).join("")}</div><div class="definition-card"><div class="notes-label">Proposed definition of done</div><p>The change supports “${escapeHtml(draft.goal)}”, the lead can point to a visible check, and no unresolved decision is silently treated as approved.</p></div><div class="modal-actions"><button class="button-subtle" data-action="edit-new-project">Edit details</button><button class="button-primary" data-action="create-project">Create project ${icon("arrow")}</button></div></section></div>`;
}

function renderGenericMessages(project) {
  return state.messages
    .filter(
      (message) => message.projectId === project.id && message.id !== `msg-${project.id}-intro`,
    )
    .map(renderMessage)
    .join("");
}

function renderProject(project) {
  const messages = state.messages.filter((message) => message.projectId === project.id);
  const intro = messages.find((message) => message.id === `msg-${project.id}-intro`);
  const systemRun = currentSimulation(project.id);
  const activity =
    project.id === "hivra" ? renderActivityCard(project) : renderExoActivity(project);
  const decisions = renderDecision(project);
  const answered = renderRecordedDecision(project);
  const history = project.id === "hivra" ? renderHistory(project) : "";
  return `${renderTopbar(project)}<div class="content-grid"><main class="conversation-column">${renderTitle(project)}<div class="chat-scroll" id="chat-scroll"><div class="day-marker"><span>Today · demo workspace</span></div>${intro ? renderMessage(intro) : ""}${renderGenericMessages(project)}${activity}${renderSimulation(project)}${decisions}${answered}${history}${systemRun ? "" : ""}</div>${renderComposer(project)}</main>${renderNotes(project)}</div>`;
}

function renderEvidenceModal() {
  if (state.modal?.type !== "evidence") return "";
  const item = state.evidence.find((evidence) => evidence.id === state.modal.evidenceId);
  if (!item) return "";
  const run = runFor(item.runId);
  return `<div class="modal-backdrop" data-action="close-modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><div class="eyebrow">Simulated evidence · ${escapeHtml(run?.id ?? "local")}</div><h2 class="modal-title" id="modal-title">${escapeHtml(item.title)}</h2></div><button class="icon-button modal-close" data-action="close-modal" aria-label="Close evidence">×</button></div><p class="modal-copy">${escapeHtml(item.detail)}</p><div class="definition-card"><div class="notes-label">Boundary</div><p>This is a local mock result. It does not change live project data or create an operational rule.</p></div><div class="modal-actions"><button class="button-primary" data-action="close-modal">Done</button></div></section></div>`;
}

function render() {
  const project = currentProject();
  const isOnboarding = state.modal?.type?.startsWith("new-project");
  const closingModal = Boolean(document.querySelector('.modal[role="dialog"]')) && !state.modal;
  const openerToRestore = closingModal ? modalOpener : null;
  const previousChatScroll = document.querySelector("#chat-scroll")?.scrollTop;
  const previousWindowScroll = window.scrollY;
  const previousFocus = document.activeElement;
  const focusAction = previousFocus?.dataset?.action;
  const focusProject = previousFocus?.dataset?.project;
  const focusOption = previousFocus?.dataset?.option;
  const focusRun = previousFocus?.dataset?.run;
  document.title =
    state.modal?.type === "new-project-form"
      ? "New project — Dropwave"
      : `${project.name} — Dropwave`;
  document.querySelector("#app").innerHTML =
    `<div class="workspace">${renderRail()}<section class="app-shell" aria-label="Dropwave project workspace">${isOnboarding ? renderTopbar(project) : project.id === "onboarding" ? renderTopbar(project) : ""}${state.modal?.type === "new-project-form" || state.modal?.type === "new-project-review" ? `<div class="content-grid"><main class="conversation-column">${renderTitle(project)}<div class="chat-scroll"><div class="day-marker">Blank project setup</div><div class="lead-message"><div class="avatar" aria-hidden="true">N</div><div class="message-body"><div class="message-meta"><span class="message-author">Nia · project lead</span><span class="message-time">now</span></div><p class="lead-copy">Describe the outcome you want to ship. I’ll propose a first loop and a definition of done for you to review before we try a sample.</p></div></div></div></main>${renderNotes(project)}</div>` : renderProject(project)}</section>${renderNotesModal(project)}${renderOnboarding()}${renderEvidenceModal()}${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ""}</div>`;
  if (previousChatScroll !== undefined)
    document.querySelector("#chat-scroll")?.scrollTo(0, previousChatScroll);
  window.scrollTo(0, previousWindowScroll);
  if (focusAction) {
    const focusTarget = [...document.querySelectorAll("[data-action]")].find(
      (element) =>
        element.dataset.action === focusAction &&
        (!focusProject || element.dataset.project === focusProject) &&
        (!focusOption || element.dataset.option === focusOption) &&
        (!focusRun || element.dataset.run === focusRun),
    );
    if (focusTarget) focusTarget.focus({ preventScroll: true });
    else if (focusAction === "answer-decision")
      document.querySelector(".decision-recorded")?.focus({ preventScroll: true });
  }
  if (closingModal) {
    modalOpener = null;
    if (openerToRestore) {
      const focusTarget = [...document.querySelectorAll("[data-action]")].find((element) =>
        Object.entries(openerToRestore).every(([key, value]) => element.dataset[key] === value),
      );
      focusTarget?.focus({ preventScroll: true });
    }
  }
  syncAnnouncer();
}

function syncAnnouncer() {
  const live = document.querySelector("#announcer");
  if (live) live.textContent = state.toast;
}

function announce(message) {
  state.toast = message;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = "";
    render();
  }, 2600);
}

function update(mutator, message = "") {
  mutator();
  persist();
  if (message) state.toast = message;
  render();
}

function answerDecision(decisionId, answer, optionId = null) {
  const decision = state.decisions.find((item) => item.id === decisionId);
  if (!decision || decision.status !== "pending" || !answer.trim()) return;
  const cleanAnswer = answer.trim();
  const evidenceId = `evidence-${decision.id}`;
  const evidence = {
    id: evidenceId,
    projectId: decision.projectId,
    runId: decision.runId,
    title: "Rollout choice recorded",
    status: "Decision simulated",
    detail: `For this demo run, the project lead recorded “${cleanAnswer}”. QA evidence remains attached to the run; this is not a standing project rule.`,
  };
  update(() => {
    decision.status = "answered";
    decision.answer = cleanAnswer;
    decision.selectedOptionId = optionId;
    decision.evidenceId = evidenceId;
    state.evidence.push(evidence);
    const run = runFor(decision.runId);
    if (run) {
      run.status = "decision-recorded";
      run.evidenceId = evidenceId;
    }
    const work = state.workItems.find((item) => item.id === "work-rollout-choice");
    if (work) work.status = "decision-recorded";
    state.messages.push({
      id: `msg-${decision.id}-answer`,
      projectId: decision.projectId,
      role: "lead",
      text: `Recorded for this run: ${cleanAnswer}. I’ve added the simulated evidence below. This choice does not become a standing rule.`,
      time: "just now",
      evidenceLink: evidenceId,
    });
  }, "Decision recorded in the local demo.");
}

function startSampleRun() {
  const project = currentProject();
  const runId = `run-${project.id}-${state.nextId++}`;
  const isExo = project.id === "exo";
  const owner = state.workers.find((item) => item.projectId === project.id) ?? state.workers[0];
  const run = {
    id: runId,
    projectId: project.id,
    number: state.runs.filter((item) => item.projectId === project.id).length + 1,
    status: "running",
    title: `Sample run for ${project.name}`,
    summary: "A local-only sample run is in progress.",
    events: [
      {
        id: `${runId}-started`,
        workerId: owner.id,
        label: isExo ? "Clarifying the sample goal" : "Lead scoped the sample",
        detail: "The demo is simulating this step locally.",
        status: "pending",
      },
      {
        id: `${runId}-check`,
        workerId: owner.id,
        label: "Checking the result",
        detail: "No agent or external service is being called.",
        status: "pending",
      },
    ],
    evidenceId: null,
  };
  update(() => {
    state.runs.push(run);
    state.selectedRunId = runId;
    state.expandedActivity = true;
  }, "Sample run started locally.");
  simulationTimer = setTimeout(() => finishSampleRun(runId), 1800);
}

function finishSampleRun(runId) {
  const run = runFor(runId);
  if (!run || run.status !== "running") return;
  const project = state.projects.find((item) => item.id === run.projectId);
  const workerId =
    state.workers.find((item) => item.projectId === run.projectId)?.id ?? state.workers[0].id;
  const evidenceId = `evidence-${runId}`;
  update(() => {
    run.status = "accepted";
    run.summary =
      "Sample run complete. The lead left a local evidence note against the project goal.";
    run.events = run.events.map((event) => ({
      ...event,
      status: "done",
      detail: "Completed as a fictional step in this local demo.",
    }));
    run.events.push({
      id: `${runId}-accepted`,
      workerId,
      label: "Sample accepted",
      detail: "The simulated result matched the sample goal; no live project changed.",
      status: "passed",
    });
    run.evidenceId = evidenceId;
    state.evidence.push({
      id: evidenceId,
      projectId: run.projectId,
      runId,
      title: "Sample run accepted",
      status: "Simulated pass",
      detail: `The lead checked the sample for ${project?.name ?? "this project"} against the goal and recorded a local-only pass.`,
    });
  }, "Sample run finished with simulated evidence.");
  simulationTimer = null;
}

function stopSampleRun() {
  const run = currentSimulation(currentProject().id);
  if (!run) return;
  clearTimeout(simulationTimer);
  simulationTimer = null;
  update(() => {
    run.status = "stopped";
    run.summary = "Stopped by you before the simulated check completed.";
    run.events = run.events.map((event) => ({
      ...event,
      status: "stopped",
      detail: "The local sample ended when you stopped it.",
    }));
  }, "Sample run stopped. No work was sent anywhere.");
}

function makeNewProject(name, goal) {
  const projectId = `project-${state.nextId++}`;
  const steps = [
    "Lead turns the goal into a small first step",
    "A builder makes one focused change",
    "The lead checks it against your goal",
    "The result and any decision stay in this conversation",
  ];
  const project = {
    id: projectId,
    name: name.trim(),
    tagline: goal.trim(),
    color: "#b6c7ff",
    loop: steps,
    definition: `The change supports “${goal.trim()}”, the lead can point to a visible check, and no unresolved decision is silently treated as approved.`,
    sampleGoal: goal.trim(),
    custom: true,
  };
  update(() => {
    state.projects.push(project);
    state.activeProjectId = projectId;
    state.workers.push({
      id: `worker-${projectId}-lead`,
      name: "Nia Park",
      role: "Project lead",
      projectId,
    });
    state.messages.push({
      id: `msg-${projectId}-intro`,
      projectId,
      role: "lead",
      text: `I’ve created a blank project for “${goal.trim()}”. The loop and definition of done are ready to change in the notes. Try a sample run when you’re ready.`,
      time: "just now",
    });
    state.runs.push({
      id: `run-${projectId}-seed`,
      projectId,
      number: 0,
      status: "draft",
      title: "Project created",
      summary: "Review the lead's proposed loop, then try a local sample run.",
      events: [
        {
          id: `evt-${projectId}-created`,
          workerId: `worker-${projectId}-lead`,
          label: "Proposed a first loop",
          detail: "The first steps are a starting point, not a fixed workflow.",
          status: "done",
        },
      ],
      evidenceId: null,
    });
    state.modal = null;
  }, `${project.name} is ready. Try a sample run when you like.`);
}

function openModal(modal, opener = document.activeElement) {
  if (!state.modal && opener instanceof HTMLElement) {
    modalOpener = Object.fromEntries(
      ["action", "focusKey", "project", "option", "run", "evidence"]
        .filter((key) => opener.dataset[key] !== undefined)
        .map((key) => [key, opener.dataset[key]]),
    );
  }
  state.modal = modal;
  render();
}

function closeModal() {
  if (!state.modal) return;
  state.modal = null;
  persist();
  render();
}

function openNewProject(opener = document.activeElement) {
  openModal({ type: "new-project-form" }, opener);
  document.querySelector("#new-project-name")?.focus();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "switch-project") {
    update(
      () => {
        state.activeProjectId = target.dataset.project;
        state.selectedRunId = null;
        state.expandedActivity = false;
        state.modal = null;
      },
      `Switched to ${state.projects.find((item) => item.id === target.dataset.project)?.name ?? "project"}.`,
    );
  } else if (action === "new-project") openNewProject(target);
  else if (action === "toggle-activity")
    update(
      () => {
        state.expandedActivity = !state.expandedActivity;
      },
      state.expandedActivity ? "Activity collapsed." : "Build and QA activity expanded.",
    );
  else if (action === "answer-decision")
    answerDecision(
      target.dataset.decision,
      state.decisions
        .find((decision) => decision.id === target.dataset.decision)
        ?.options.find((option) => option.id === target.dataset.option)?.title ?? "",
      target.dataset.option,
    );
  else if (action === "reset-demo") {
    clearTimeout(simulationTimer);
    clearTimeout(toastTimer);
    localStorage.removeItem(STORAGE_KEY);
    state = makeSeed();
    render();
    announce("Demo reset to the original fictional state.");
  } else if (action === "open-notes") {
    openModal({ type: "notes" }, target);
    document.querySelector(".modal-close")?.focus();
  } else if (action === "close-modal") closeModal();
  else if (action === "close-modal-backdrop" && event.target === target) closeModal();
  else if (action === "start-run") startSampleRun();
  else if (action === "stop-run") stopSampleRun();
  else if (action === "inspect-run")
    update(() => {
      state.selectedRunId = target.dataset.run;
      state.expandedActivity = true;
      state.modal = null;
    });
  else if (action === "show-run-evidence") {
    const run = runFor(target.dataset.run);
    if (run?.evidenceId) {
      openModal({ type: "evidence", evidenceId: run.evidenceId }, target);
      document.querySelector(".modal-close")?.focus();
    } else announce("This run has no evidence card yet.");
  } else if (action === "show-evidence") {
    openModal({ type: "evidence", evidenceId: target.dataset.evidence }, target);
    document.querySelector(".modal-close")?.focus();
  } else if (action === "change-loop") {
    openModal({ type: "loop-editor" }, target);
    document.querySelector("#loop-step-0")?.focus();
  } else if (action === "edit-new-project") {
    state.modal = { type: "new-project-form", draft: state.modal?.draft };
    render();
    document.querySelector("#new-project-name").value = state.modal.draft.name;
    document.querySelector("#new-project-goal").value = state.modal.draft.goal;
    document.querySelector("#new-project-name")?.focus();
  } else if (action === "create-project") {
    const draft = state.modal?.draft;
    if (draft) makeNewProject(draft.name, draft.goal);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches('[data-action="mobile-switch"]')) {
    const projectId = event.target.value;
    update(
      () => {
        state.activeProjectId = projectId;
        state.selectedRunId = null;
        state.expandedActivity = false;
        state.modal = null;
      },
      `Switched to ${state.projects.find((item) => item.id === projectId)?.name ?? "project"}.`,
    );
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  if (form.dataset.form === "custom-answer") {
    answerDecision(form.dataset.decision, String(data.get("answer") ?? ""));
  } else if (form.dataset.form === "chat") {
    const message = String(data.get("message") ?? "").trim();
    if (!message) return;
    update(() => {
      state.messages.push({
        id: `msg-${state.nextId++}`,
        projectId: currentProject().id,
        role: "user",
        text: message,
        time: "just now",
      });
      state.messages.push({
        id: `msg-${state.nextId++}`,
        projectId: currentProject().id,
        role: "lead",
        text: "Captured in this local demo. No agent was contacted or project data changed.",
        time: "just now",
      });
    }, "Message saved in this browser only.");
  } else if (form.dataset.form === "new-project") {
    const name = String(data.get("name") ?? "").trim();
    const goal = String(data.get("goal") ?? "").trim();
    if (!name || !goal) return;
    state.modal = { type: "new-project-review", draft: { name, goal } };
    render();
    document.querySelector('[data-action="create-project"]')?.focus();
  } else if (form.dataset.form === "edit-loop") {
    const project = currentProject();
    update(() => {
      project.loop = project.loop.map((_, index) => String(data.get(`step-${index}`) ?? "").trim());
      project.definition = String(data.get("definition") ?? "").trim();
      state.modal = null;
    }, "Project loop updated locally.");
  }
});

document.addEventListener("keydown", (event) => {
  if (!state.modal) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key !== "Tab") return;
  const dialog = document.querySelector('.modal[role="dialog"]');
  if (!dialog) return;
  const focusableElements = [
    ...dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
  const target = focusTrapTarget(focusableElements, document.activeElement, event.shiftKey);
  if (target) {
    event.preventDefault();
    target.focus({ preventScroll: true });
  }
});

render();
