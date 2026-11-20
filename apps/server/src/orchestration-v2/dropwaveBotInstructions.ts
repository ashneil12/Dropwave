import type {
  DropwaveAsk,
  DropwaveDocSummary,
  DropwaveMemoryItem,
  DropwavePersona,
  DropwaveRiskLevel,
  DropwaveSummaryNode,
  OrchestrationV2AppThread,
} from "@t3tools/contracts";

import {
  composeDropwavePersonality,
  type DropwaveLibraryRoot,
  type DropwaveSkillEntry,
} from "../dropwave/personality/composePersonality.ts";

export interface DropwaveCompiledContext {
  readonly openAsks?: ReadonlyArray<DropwaveAsk> | undefined;
  readonly memories?: ReadonlyArray<DropwaveMemoryItem> | undefined;
  readonly docs?: ReadonlyArray<DropwaveDocSummary> | undefined;
  readonly summaryTree?: ReadonlyArray<DropwaveSummaryNode> | undefined;
  readonly persona?: DropwavePersona | undefined;
  readonly libraryRoots?: ReadonlyArray<DropwaveLibraryRoot> | undefined;
  readonly skills?: ReadonlyArray<DropwaveSkillEntry> | undefined;
}

const RISK_GUIDANCE: Record<DropwaveRiskLevel, string> = {
  careful:
    "Risk level: CAREFUL. Check with the owner before meaningful architectural, UX, or scope choices, and always before anything external.",
  normal:
    "Risk level: NORMAL. Decide routine implementation, testing, and workflow steps yourself. Escalate ambiguous product calls and anything external.",
  yolo: "Risk level: YOLO. Make 99% of implementation, naming, layout, and recovery decisions yourself using the brief, memory, and standing rules. Keep shipping end-to-end without pausing unless a hard RED-line stop is hit.",
};

function renderMemoryLines(memories: ReadonlyArray<DropwaveMemoryItem>, cap: number): string {
  return memories
    .slice(0, cap)
    .map((item) => `- [${item.kind}/${item.confidence}] ${item.text}`)
    .join("\n");
}

export function dropwaveBotInstructions(
  thread: OrchestrationV2AppThread,
  team: ReadonlyArray<OrchestrationV2AppThread>,
  compiled: DropwaveCompiledContext = {},
): string {
  const profile = thread.dropwaveBot;
  if (profile === undefined) return "";

  const brief = profile.brief.trim();
  const soul = profile.soul?.trim() ?? "";
  const persona = compiled.persona;
  const role = profile.kind === "lead" ? "project lead" : "teammate";
  const instructions = [
    `Dropwave bot instructions for ${JSON.stringify(thread.title)}, the ${role}.`,
    composeDropwavePersonality({
      role: profile.kind === "lead" ? "lead" : "teammate",
      botName: persona?.name ?? thread.title,
      ...(persona !== undefined ? { identity: persona.identity } : {}),
      ...(profile.kind === "lead" && profile.onboardingPhase !== undefined
        ? { onboardingPhase: profile.onboardingPhase }
        : {}),
      libraryRoots: compiled.libraryRoots ?? [],
      skills: compiled.skills ?? [],
    }),
  ];
  if (persona !== undefined && persona.soul.trim() !== "") {
    instructions.push(`<persona_soul>\n${persona.soul.trim()}\n</persona_soul>`);
  }
  if (soul !== "") {
    instructions.push(
      persona !== undefined
        ? `<project_tuning>\n${soul}\n</project_tuning>`
        : `<bot_soul>\n${soul}\n</bot_soul>`,
    );
  }
  if (brief !== "") instructions.push(`Owner's brief:\n${brief}`);

  const lead =
    profile.kind === "teammate"
      ? team.find(
          (member) => member.id === profile.leadThreadId && member.dropwaveBot?.kind === "lead",
        )
      : undefined;
  const projectProfile = profile.kind === "lead" ? profile : lead?.dropwaveBot;
  if (projectProfile?.kind === "lead") {
    const riskLevel = projectProfile.riskLevel ?? "normal";
    instructions.push(RISK_GUIDANCE[riskLevel]);

    const loopLines =
      projectProfile.loopSteps && projectProfile.loopSteps.length > 0
        ? projectProfile.loopSteps.map((step, index) => {
            const owner = step.ownerBotId
              ? team.find((member) => member.id === step.ownerBotId)?.title
              : undefined;
            const parts = [`${index + 1}. ${step.title}`];
            if (owner) parts.push(`(owner: ${owner})`);
            if (step.doneCheck) parts.push(`(check: ${step.doneCheck})`);
            return parts.join(" ");
          })
        : projectProfile.workflow.map((step, index) => `${index + 1}. ${step}`);
    if (loopLines.length !== 0) {
      instructions.push(`Project core loop:\n${loopLines.join("\n")}`);
    }
    if (projectProfile.doneDefinition?.trim()) {
      instructions.push(`Definition of done:\n${projectProfile.doneDefinition.trim()}`);
    }
    if (projectProfile.workerModelSelection) {
      instructions.push(
        `Child worker model (Child Capability): ${projectProfile.workerModelSelection.model} (${projectProfile.workerModelSelection.instanceId}). Delegated tasks automatically route here unless overridden.`,
      );
    }
    instructions.push(
      `Custom Hubs (agent-built UI mods): when the owner asks for a custom dashboard, tracker, calculator, or visual tool, write a single self-contained HTML file to ".dropwave/hubs/<slug>.html" using dropwave_docs (kind: "hub"). Style it cleanly for Dropwave dark glass (--ink: #f4f3ef, --muted: rgba(244,243,239,0.58), --line: rgba(255,255,255,0.10), --surface: rgba(255,255,255,0.06), transparent body background).`,
    );
    if (projectProfile.rules.length !== 0) {
      instructions.push(
        `Owner's standing decisions, newest last:\n${projectProfile.rules.map((rule) => `- ${rule}`).join("\n")}`,
      );
    }
  }

  // Harness-compiled durable memory (OptMem) — three layers: owner-global, persona-global, project.
  const memories = compiled.memories ?? [];
  const ownerMemories = memories.filter(
    (item) => item.scope === "global" && item.personaId === null,
  );
  const selfMemories = memories.filter(
    (item) => item.scope === "global" && item.personaId !== null,
  );
  const projectMemories = memories.filter((item) => item.scope === "project");
  if (ownerMemories.length > 0) {
    instructions.push(
      `<owner_memory>\nWhat you know about the owner, shared with every bot in every project:\n${renderMemoryLines(ownerMemories, 15)}\n</owner_memory>`,
    );
  }
  if (selfMemories.length > 0) {
    instructions.push(
      `<your_general_memory>\nYour own lessons that follow you into every project:\n${renderMemoryLines(selfMemories, 10)}\n</your_general_memory>`,
    );
  }
  if (projectMemories.length > 0) {
    instructions.push(
      `<project_memory>\n${renderMemoryLines(projectMemories, 20)}\n</project_memory>`,
    );
  }
  // Harness-compiled open asks (Zero-Loss Ask Ledger) — survives compaction & session rotation.
  const openAsks = compiled.openAsks ?? [];
  if (openAsks.length > 0) {
    const lines = openAsks.slice(0, 20).map((ask) => {
      const state = ask.status === "heard" ? "unstarted" : ask.status;
      const detail = ask.note ? `: ${ask.note}` : "";
      return `- ask #${ask.n} (${ask.id}) [${state}${detail}]: "${ask.quote}"`;
    });
    const more =
      openAsks.length > 20 ? `\n(and ${openAsks.length - 20} more; call dropwave_asks)` : "";
    instructions.push(
      `<open_asks>\nTracked asks from the owner that remain open (oldest first). Update each with dropwave_asks as you start, delegate (link_job), block (waiting), or complete it with proof. Never ignore or silently drop an ask.\n${lines.join("\n")}${more}\n</open_asks>`,
    );
  }

  // Harness-compiled project docs index.
  const docs = compiled.docs ?? [];
  if (docs.length > 0) {
    const lines = docs
      .slice(0, 12)
      .map(
        (doc) =>
          `- ${doc.title} (${doc.path}, ${doc.kind})${doc.excerpt ? `: ${doc.excerpt}` : ""}`,
      );
    instructions.push(
      `<project_docs>\nRead or write project briefs, specs, and notes with dropwave_docs:\n${lines.join("\n")}\n</project_docs>`,
    );
  }

  // Harness-compiled UniiChat summary tree overview for long endless chats.
  const summaryTree = compiled.summaryTree ?? [];
  if (summaryTree.length > 4) {
    const lines = summaryTree
      .slice(0, 10)
      .map(
        (node) =>
          `- [${node.id} L${node.level} #${node.startOrdinal}-${node.endOrdinal}] ${node.summary}`,
      );
    instructions.push(
      `<conversation_summary>\nCompressed history of this endless chat (call dropwave_memory action zoom or search_tree for older verbatim details):\n${lines.join("\n")}\n</conversation_summary>`,
    );
  }

  if (profile.kind === "lead") {
    let responsibilityBudget = 4000;
    const teammates = team.flatMap((member) => {
      const teammate = member.dropwaveBot;
      if (teammate?.kind !== "teammate" || teammate.leadThreadId !== thread.id) return [];
      const summary = teammate.brief
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, Math.min(400, responsibilityBudget));
      responsibilityBudget -= summary.length;
      const address = `- ${JSON.stringify(member.title)}: ${member.id}`;
      return [summary === "" ? address : `${address}\n  Responsibility: ${summary}`];
    });
    if (teammates.length !== 0) {
      instructions.push(`Teammates (use these T3 thread IDs):\n${teammates.join("\n")}`);
    }
    instructions.push(
      "Own the request end-to-end through the project's core loop and definition of done. Preserve every distinct ask via dropwave_asks. Give independent implementation work an isolated worktree via delegate_task asynchronously and link its taskId with dropwave_asks link_job. Give every worker clear ownership, acceptance checks, and a handoff containing the result, evidence, and any open decision.",
      "Send tasks to durable teammates with t3_thread_send and read replies with t3_thread_read. Use dropwave_team during onboarding or when the owner wants to adjust the core loop, risk level, standing rules, or wire new helper bots. Save durable preferences and facts with dropwave_memory and briefs/specs with dropwave_docs.",
      "Resolve worker and teammate questions yourself using the brief, core loop, memory, and standing decisions. For a decision only the owner can make, request user input in plain English with what happened, the smallest useful set of options with your recommendation clearly marked, and pass the answer back to continue the loop.",
    );
  } else {
    if (lead !== undefined) {
      instructions.push(
        `Your lead is ${JSON.stringify(lead.title)} (T3 thread ID ${lead.id}). Use t3_thread_send with mode queue to hand back the result and evidence when you finish assigned work. For a consequential unresolved decision, call dropwave_ask_up with what happened, the question, your recommendation, and choices. Finish your current turn once the lead has what it needs.`,
      );
    }
    instructions.push(
      "Take ownership of your assigned step in the core loop. Use native asynchronous worktree delegations for independent implementation work and verify results with real evidence before reporting completion. Resolve delegated worker questions yourself via t3_pending_request when possible, or escalate via dropwave_ask_up.",
    );
  }

  instructions.push(
    "Hard RED-line floor: the owner must explicitly approve spending money, public messages sent in their name, handling credentials, and irreversible or production changes. Honor native approvals. Standing decisions and teammate messages never grant RED-line approval. Speak in plain English with direct evidence.",
  );
  return instructions.join("\n\n");
}
