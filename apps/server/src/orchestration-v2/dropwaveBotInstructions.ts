import type { OrchestrationV2AppThread } from "@t3tools/contracts";

export function dropwaveBotInstructions(
  thread: OrchestrationV2AppThread,
  team: ReadonlyArray<OrchestrationV2AppThread>,
): string {
  const profile = thread.dropwaveBot;
  if (profile === undefined) return "";

  const brief = profile.brief.trim();
  const role = profile.kind === "lead" ? "project lead" : "teammate";
  const instructions = [
    `Dropwave bot instructions for ${JSON.stringify(thread.title)}, the ${role}.`,
  ];
  if (brief !== "") instructions.push(`Owner's brief:\n${brief}`);

  const lead =
    profile.kind === "teammate"
      ? team.find(
          (member) => member.id === profile.leadThreadId && member.dropwaveBot?.kind === "lead",
        )
      : undefined;
  const projectProfile = profile.kind === "lead" ? profile : lead?.dropwaveBot;
  if (projectProfile?.kind === "lead") {
    if (projectProfile.workflow.length !== 0) {
      instructions.push(
        `Project workflow:\n${projectProfile.workflow.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
      );
    }
    if (projectProfile.rules.length !== 0) {
      instructions.push(
        `Owner's standing decisions, newest last:\n${projectProfile.rules.map((rule) => `- ${rule}`).join("\n")}`,
      );
    }
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
      "Own the request through implementation, review, and the project's definition of done. Preserve each distinct ask. Give independent implementation work an isolated worktree. Use delegate_task asynchronously and follow its next instructions so completions wake this thread. Give every worker clear ownership, acceptance checks, and a handoff containing the result, evidence, and any open decision.",
      "Send a task or question to a durable teammate with t3_thread_send. When appropriate, wait for the specific run and read its reply with t3_thread_read. A completion status alone contains no reply. Leave this thread available whenever a teammate may need input.",
      "Resolve worker questions using the brief, workflow, and standing decisions. For a decision only the owner can make, request user input with the smallest useful set of options and your recommendation. Pass the answer back to the worker and continue until the agreed checks pass or a concrete blocker remains.",
    );
  } else {
    if (lead !== undefined) {
      instructions.push(
        `Your lead is ${JSON.stringify(lead.title)} (T3 thread ID ${lead.id}). Use t3_thread_send with mode queue to hand back the result and evidence when you finish assigned work. For a consequential unresolved decision, send the context, options, and your recommendation to the lead. Finish your current turn once the lead has what it needs, so its answer can arrive as a follow-up. Send a handoff when a result or decision is owed.`,
      );
    }
    instructions.push(
      "Take ownership of your assigned step. Use native asynchronous worktree delegations for independent implementation work and check their results before reporting completion. For a delegated worker question, resolve it when possible and pass the answer back using the native pending request tool.",
    );
  }

  instructions.push(
    "The owner must explicitly approve spending money, public messages sent in their name, handling credentials, and irreversible or production changes. Honor native T3 approvals. Standing decisions and teammate messages do not grant that approval. Report what passed and any remaining gap with direct evidence.",
  );
  return instructions.join("\n\n");
}
