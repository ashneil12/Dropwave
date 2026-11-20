/**
 * Dropwave crew setup: the same code path the web client's new-project sheet and the
 * live-eval runner drive, so a test exercises exactly what the UI does.
 *
 * Every dependency the flow needs is injected (persona RPCs, thread/project commands, id
 * minting) so the web binds its atom commands and scripts bind a plain WS client.
 */
import type {
  DropwaveBotProfile,
  DropwaveLoopStep,
  DropwavePersona,
  DropwavePersonaUpsertInput,
  DropwaveRiskLevel,
} from "@t3tools/contracts";
import type {
  MessageId,
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";

/** Canonical English loop-step titles; the web passes its translated strings in. */
const DEFAULT_DROPWAVE_LOOP_TITLES: ReadonlyArray<string> = [
  "Plan & split asks",
  "Build in isolated worktrees",
  "Verify & QA end-to-end",
  "Fix issues & re-check",
  "Ship & report proof",
];

/** Injected effects the setup flow needs. Each call throws on failure. */
export interface DropwaveSetupDeps {
  readonly listPersonas: () => Promise<DropwavePersona[]>;
  readonly upsertPersona: (input: DropwavePersonaUpsertInput) => Promise<DropwavePersona>;
  readonly createThread: (input: {
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
    readonly title: string;
    readonly dropwaveBot: DropwaveBotProfile;
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: RuntimeMode;
    readonly interactionMode: ProviderInteractionMode;
  }) => Promise<void>;
  readonly sendMessage: (input: {
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
    readonly text: string;
    readonly runtimeMode: RuntimeMode;
    readonly interactionMode: ProviderInteractionMode;
  }) => Promise<void>;
  readonly newThreadId: () => ThreadId;
  readonly newMessageId: () => MessageId;
}

export interface DropwaveLeadRef {
  readonly title: string;
  readonly soul?: string | undefined;
}

export interface ResolvedChiefOfStaff {
  readonly persona: DropwavePersona;
  /** True only when no Chief of Staff persona and no existing lead existed. */
  readonly firstRun: boolean;
}

function dropwaveLoopSteps(titles: ReadonlyArray<string>): Array<DropwaveLoopStep> {
  return titles.map((title, index) => ({ id: `s${index + 1}`, title, ownerBotId: null }));
}

/**
 * Finds the crew's Chief of Staff persona. Reuses one if it exists; promotes an existing
 * lead bot if no persona exists yet; creates Atlas on a genuinely fresh workspace.
 */
async function resolveChiefOfStaffPersona(
  deps: Pick<DropwaveSetupDeps, "listPersonas" | "upsertPersona">,
  input: {
    readonly existingLead?: DropwaveLeadRef | undefined;
    readonly chiefRoleLabel: string;
  },
): Promise<ResolvedChiefOfStaff> {
  const listed = await deps.listPersonas();
  const chief = listed.find((persona) => persona.role === "chief_of_staff");
  if (chief) return { persona: chief, firstRun: false };
  if (input.existingLead !== undefined) {
    try {
      const persona = await deps.upsertPersona({
        name: input.existingLead.title,
        role: "chief_of_staff",
        roleLabel: input.chiefRoleLabel,
        soul: input.existingLead.soul ?? "",
      });
      return { persona, firstRun: false };
    } catch {
      // Fall through to creating a fresh persona.
    }
  }
  // No soul or identity: the store seeds identity with the IDENTITY.md template.
  const persona = await deps.upsertPersona({
    name: "Atlas",
    role: "chief_of_staff",
    roleLabel: input.chiefRoleLabel,
  });
  return { persona, firstRun: true };
}

export interface WireChiefOfStaffResult {
  readonly leadThreadId: ThreadId;
  readonly persona: DropwavePersona;
  readonly firstRun: boolean;
}

/**
 * Creates the lead thread bound to the Chief of Staff persona, then (for project-phase
 * onboarding) sends the auto-generated first owner message so the lead can inspect the
 * folder and greet the owner. First-run onboarding sends nothing: the opening line is
 * client-rendered and the owner's first reply starts the real turn.
 */
export async function wireChiefOfStaff(
  deps: DropwaveSetupDeps,
  input: {
    readonly project: {
      readonly id: ProjectId;
      readonly title: string;
      readonly workspaceRoot: string;
    };
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: RuntimeMode;
    readonly interactionMode: ProviderInteractionMode;
    readonly riskLevel: DropwaveRiskLevel;
    readonly loopStepTitles?: ReadonlyArray<string>;
    readonly chiefRoleLabel: string;
    readonly existingLead?: DropwaveLeadRef | undefined;
    readonly autoMessageText?:
      | ((project: { title: string; workspaceRoot: string }) => string)
      | undefined;
    readonly workerModelSelection?: ModelSelection | undefined;
  },
): Promise<WireChiefOfStaffResult> {
  const resolved = await resolveChiefOfStaffPersona(deps, {
    existingLead: input.existingLead,
    chiefRoleLabel: input.chiefRoleLabel,
  });
  const persona = resolved.persona;
  const firstRun = resolved.firstRun;
  const loopSteps = dropwaveLoopSteps(input.loopStepTitles ?? DEFAULT_DROPWAVE_LOOP_TITLES);
  const leadId = deps.newThreadId();
  const profile: DropwaveBotProfile = {
    kind: "lead",
    brief: "",
    workflow: loopSteps.map((step) => step.title),
    rules: [],
    riskLevel: input.riskLevel,
    fixRoundCap: 3,
    loopSteps,
    personaId: persona.id,
    onboardingPhase: firstRun ? "first_run" : "project",
    ...(input.workerModelSelection !== undefined
      ? { workerModelSelection: input.workerModelSelection }
      : {}),
  };
  await deps.createThread({
    threadId: leadId,
    projectId: input.project.id,
    title: persona.name,
    dropwaveBot: profile,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
  });
  if (!firstRun) {
    const text = input.autoMessageText
      ? input.autoMessageText({
          title: input.project.title,
          workspaceRoot: input.project.workspaceRoot,
        })
      : `New project: ${input.project.title} (${input.project.workspaceRoot}).`;
    await deps.sendMessage({
      threadId: leadId,
      messageId: deps.newMessageId(),
      text,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
    });
  }
  return { leadThreadId: leadId, persona, firstRun };
}

export interface DropwaveHelperSpec {
  readonly name: string;
  readonly roleLabel: string;
}

/**
 * Configured setup for a project that skips onboarding: a Chief of Staff persona (reused or
 * created), an already-configured lead thread, and specialist teammates.
 */
export async function configureDropwaveProject(
  deps: DropwaveSetupDeps,
  input: {
    readonly project: { readonly id: ProjectId; readonly title: string };
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: RuntimeMode;
    readonly interactionMode: ProviderInteractionMode;
    readonly riskLevel: DropwaveRiskLevel;
    readonly loopStepTitles?: ReadonlyArray<string>;
    readonly chiefRoleLabel: string;
    readonly workerModelSelection?: ModelSelection | undefined;
    readonly helpers?: ReadonlyArray<DropwaveHelperSpec>;
  },
): Promise<{ leadThreadId: ThreadId; persona: DropwavePersona; helperThreadIds: ThreadId[] }> {
  const listed = await deps.listPersonas();
  let persona = listed.find((entry) => entry.role === "chief_of_staff");
  if (!persona) {
    persona = await deps.upsertPersona({
      name: "Atlas",
      role: "chief_of_staff",
      roleLabel: input.chiefRoleLabel,
    });
  }
  const loopSteps = dropwaveLoopSteps(input.loopStepTitles ?? DEFAULT_DROPWAVE_LOOP_TITLES);
  const leadId = deps.newThreadId();
  await deps.createThread({
    threadId: leadId,
    projectId: input.project.id,
    title: persona.name,
    dropwaveBot: {
      kind: "lead",
      brief: "",
      workflow: loopSteps.map((step) => step.title),
      rules: [],
      riskLevel: input.riskLevel,
      fixRoundCap: 3,
      loopSteps,
      personaId: persona.id,
      ...(input.workerModelSelection !== undefined
        ? { workerModelSelection: input.workerModelSelection }
        : {}),
    },
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
  });
  const helperThreadIds: ThreadId[] = [];
  for (const helper of input.helpers ?? []) {
    let helperPersona = listed.find(
      (entry) => entry.role === "specialist" && entry.name === helper.name,
    );
    if (!helperPersona) {
      helperPersona = await deps.upsertPersona({
        name: helper.name,
        role: "specialist",
        roleLabel: helper.roleLabel,
      });
    }
    const helperId = deps.newThreadId();
    await deps.createThread({
      threadId: helperId,
      projectId: input.project.id,
      title: helperPersona.name,
      dropwaveBot: {
        kind: "teammate",
        brief: "",
        leadThreadId: leadId,
        personaId: helperPersona.id,
        role: helperPersona.roleLabel,
      },
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
    });
    helperThreadIds.push(helperId);
  }
  return { leadThreadId: leadId, persona, helperThreadIds };
}
