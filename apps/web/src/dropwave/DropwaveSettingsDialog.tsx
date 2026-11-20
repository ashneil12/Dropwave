import type { DropwaveRiskLevel } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, msg, useGT, useMessages } from "gt-react";
import {
  ArrowUpRightIcon,
  CpuIcon,
  FolderGit2Icon,
  ImageIcon,
  KeyRoundIcon,
  LayoutGridIcon,
  PlugIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { Dialog, DialogPopup } from "../components/ui/dialog";
import { DropwaveSelect, type DropwaveSelectOption } from "./DropwaveSelect";
import type { useDropwaveAppearance } from "./DropwaveToolbar";
import {
  useDropwaveWorkspace,
  type DropwaveSlotLayout,
  type DropwaveWidgetKind,
} from "./workspaceContext";

type SettingsSection = "dropwave" | "layout" | "engine";

const PRESETS = [
  { key: "mountains", file: "mountains.jpg", label: msg("Mountains") },
  { key: "ocean", file: "ocean.jpg", label: msg("Ocean") },
  { key: "abstract", file: "abstract.jpg", label: msg("Abstract") },
  { key: "sunrise", file: "sunrise.jpg", label: msg("Sunrise") },
  { key: "dusk", file: "dusk.png", label: msg("Dusk") },
] as const;

const WIDGET_CHOICES: ReadonlyArray<{
  readonly value: DropwaveWidgetKind;
  readonly label: string;
}> = [
  { value: "asks", label: msg("Core Loop & Asks") },
  { value: "agents", label: msg("Team & Agents") },
  { value: "reviews", label: msg("Pending Reviews") },
  { value: "sessions", label: msg("Running Sessions") },
  { value: "docs", label: msg("Docs & Briefs") },
  { value: "memory", label: msg("Memory & Rules") },
];

const DEFAULT_LAYOUT: DropwaveSlotLayout = {
  topLeft: "asks",
  bottomLeft: "agents",
  topRight: "reviews",
  bottomRight: "sessions",
};

export function DropwaveSettingsDialog({
  open,
  onClose,
  appearance,
  defaultRisk,
  onChangeDefaultRisk,
}: {
  open: boolean;
  onClose: () => void;
  appearance: ReturnType<typeof useDropwaveAppearance>;
  defaultRisk: DropwaveRiskLevel;
  onChangeDefaultRisk: (next: DropwaveRiskLevel) => void;
}) {
  const workspace = useDropwaveWorkspace();
  const navigate = useNavigate();
  const gt = useGT();
  const m = useMessages();
  const [section, setSection] = useState<SettingsSection>("dropwave");

  if (!open || !workspace) return null;

  const widgetOptions: ReadonlyArray<DropwaveSelectOption<DropwaveWidgetKind>> = WIDGET_CHOICES.map(
    (c) => ({ value: c.value, label: m(c.label) }),
  );

  const openEngineRoute = (
    to:
      | "/settings/providers"
      | "/settings/projects"
      | "/settings/worktrees"
      | "/settings/connections"
      | "/settings/general",
  ) => {
    onClose();
    void navigate({ to });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup data-dw-settings-modal="" showCloseButton={false}>
        <div data-dw-settings-shell="">
          <aside data-dw-settings-nav="">
            <div data-dw-settings-brand="">
              <span data-dw-brand-dot="" />
              <strong>
                <T>Dropwave Settings</T>
              </strong>
            </div>

            <nav aria-label={gt("Dropwave settings sections")}>
              <button
                type="button"
                data-dw-settings-nav-item=""
                aria-current={section === "dropwave" ? "true" : undefined}
                onClick={() => setSection("dropwave")}
              >
                <SlidersHorizontalIcon className="size-4" />
                <span>
                  <T>Workspace & Look</T>
                </span>
              </button>
              <button
                type="button"
                data-dw-settings-nav-item=""
                aria-current={section === "layout" ? "true" : undefined}
                onClick={() => setSection("layout")}
              >
                <LayoutGridIcon className="size-4" />
                <span>
                  <T>Side Panels</T>
                </span>
              </button>

              <div data-dw-settings-divider="">
                <T>Backend Engine</T>
              </div>

              <button
                type="button"
                data-dw-settings-nav-item=""
                aria-current={section === "engine" ? "true" : undefined}
                onClick={() => setSection("engine")}
              >
                <CpuIcon className="size-4" />
                <span>
                  <T>T3 Engine & Providers</T>
                </span>
              </button>
            </nav>
          </aside>

          <div data-dw-settings-main="">
            <header data-dw-settings-header="">
              <h2>
                {section === "dropwave" ? (
                  <T>Workspace & Look</T>
                ) : section === "layout" ? (
                  <T>Side Panels</T>
                ) : (
                  <T>T3 Engine & Providers</T>
                )}
              </h2>
              <button
                type="button"
                data-dw-mini-icon=""
                aria-label={gt("Close settings")}
                onClick={onClose}
              >
                <XIcon className="size-4" />
              </button>
            </header>

            <div data-dw-settings-body="">
              {section === "dropwave" ? (
                <>
                  <section data-dw-settings-group="">
                    <h3>
                      <ImageIcon className="size-3.5" data-dw-icon="indigo" />
                      <T>Glass & Wallpaper</T>
                    </h3>
                    <div data-dropwave-wallpapers="">
                      {PRESETS.map((wall) => (
                        <button
                          key={wall.key}
                          type="button"
                          aria-label={m(wall.label)}
                          aria-pressed={appearance.wallpaper === wall.key}
                          onClick={() => appearance.setWallpaper(wall.key)}
                        >
                          <img src={`/dropwave/${wall.file}`} alt="" />
                        </button>
                      ))}
                    </div>
                    <div data-dw-settings-row="">
                      <label data-dropwave-upload-wall="">
                        <UploadIcon />
                        <span>
                          <T>Upload custom wallpaper</T>
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = () => {
                              appearance.setCustomWallpaper(String(reader.result));
                              appearance.setWallpaper("custom");
                            };
                            reader.readAsDataURL(file);
                          }}
                        />
                      </label>
                    </div>
                    <label data-dw-range-row="">
                      <span>
                        <T>Glass opacity & blur</T>
                      </span>
                      <input
                        type="range"
                        min={0.4}
                        max={1.6}
                        step={0.05}
                        value={appearance.strength}
                        onChange={(e) => appearance.setStrength(e.currentTarget.valueAsNumber)}
                      />
                    </label>
                  </section>

                  <section data-dw-settings-group="">
                    <h3>
                      <ShieldCheckIcon className="size-3.5" data-dw-icon="emerald" />
                      <T>Default Autonomy Posture</T>
                    </h3>
                    <p data-dw-settings-desc="">
                      <T>
                        How aggressively new Chief of Staff bots make calls before pausing to ask
                        you.
                      </T>
                    </p>
                    <div data-dw-risk-pills="">
                      {(["careful", "normal", "yolo"] as const).map((level) => (
                        <button
                          key={level}
                          type="button"
                          data-dw-risk-btn=""
                          aria-pressed={defaultRisk === level}
                          onClick={() => onChangeDefaultRisk(level)}
                        >
                          {level === "yolo"
                            ? "YOLO"
                            : level === "careful"
                              ? gt("Careful")
                              : gt("Normal")}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section data-dw-settings-group="">
                    <h3>
                      <T>Workspace Data Source</T>
                    </h3>
                    <p data-dw-settings-desc="">
                      <T>
                        Preview loads realistic sample ventures so you can test layouts; Live
                        connects to your real repositories and agents.
                      </T>
                    </p>
                    <div data-dw-risk-pills="">
                      <button
                        type="button"
                        data-dw-risk-btn=""
                        aria-pressed={workspace.mode === "preview"}
                        onClick={() => workspace.setMode("preview")}
                      >
                        <T>Preview Showcase</T>
                      </button>
                      <button
                        type="button"
                        data-dw-risk-btn=""
                        aria-pressed={workspace.mode === "live"}
                        onClick={() => workspace.setMode("live")}
                      >
                        <T>Live Harness</T>
                      </button>
                    </div>
                  </section>
                </>
              ) : section === "layout" ? (
                <section data-dw-settings-group="">
                  <div data-dw-settings-row-head="">
                    <div>
                      <h3>
                        <T>Customize all 4 side panels</T>
                      </h3>
                      <p data-dw-settings-desc="">
                        <T>Choose which screen sits in each floating corner around your chat.</T>
                      </p>
                    </div>
                    <button
                      type="button"
                      data-dw-ghost-xs=""
                      onClick={() => {
                        workspace.setSlotWidget("topLeft", DEFAULT_LAYOUT.topLeft);
                        workspace.setSlotWidget("bottomLeft", DEFAULT_LAYOUT.bottomLeft);
                        workspace.setSlotWidget("topRight", DEFAULT_LAYOUT.topRight);
                        workspace.setSlotWidget("bottomRight", DEFAULT_LAYOUT.bottomRight);
                      }}
                    >
                      <RotateCcwIcon className="size-3" />
                      <T>Reset</T>
                    </button>
                  </div>

                  <div data-dw-slot-grid="">
                    {(
                      [
                        { slot: "topLeft", label: gt("Top Left") },
                        { slot: "topRight", label: gt("Top Right") },
                        { slot: "bottomLeft", label: gt("Bottom Left") },
                        { slot: "bottomRight", label: gt("Bottom Right") },
                      ] as const
                    ).map(({ slot, label }) => (
                      <div key={slot} data-dw-slot-setting="">
                        <span>{label}</span>
                        <DropwaveSelect
                          value={workspace.slots[slot]}
                          options={widgetOptions}
                          ariaLabel={label}
                          onChange={(next) => workspace.setSlotWidget(slot, next)}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              ) : (
                <section data-dw-settings-group="">
                  <h3>
                    <T>Underlying T3 Engine Settings</T>
                  </h3>
                  <p data-dw-settings-desc="">
                    <T>
                      Most Dropwave settings live in the first two tabs. Open these backend engine
                      controls when you need to manage AI providers, local folders, git worktrees,
                      or remote connections.
                    </T>
                  </p>

                  <div data-dw-engine-links="">
                    <button
                      type="button"
                      data-dw-engine-card=""
                      onClick={() => openEngineRoute("/settings/providers")}
                    >
                      <KeyRoundIcon className="size-4" data-dw-icon="indigo" />
                      <div>
                        <strong>
                          <T>Providers & Models</T>
                        </strong>
                        <small>
                          <T>Claude, Codex, Cursor, OpenCode, and API credentials</T>
                        </small>
                      </div>
                      <ArrowUpRightIcon className="size-4 opacity-60" />
                    </button>

                    <button
                      type="button"
                      data-dw-engine-card=""
                      onClick={() => openEngineRoute("/settings/projects")}
                    >
                      <FolderGit2Icon className="size-4" data-dw-icon="emerald" />
                      <div>
                        <strong>
                          <T>Projects & Repositories</T>
                        </strong>
                        <small>
                          <T>Linked project folders, default models, and git settings</T>
                        </small>
                      </div>
                      <ArrowUpRightIcon className="size-4 opacity-60" />
                    </button>

                    <button
                      type="button"
                      data-dw-engine-card=""
                      onClick={() => openEngineRoute("/settings/worktrees")}
                    >
                      <CpuIcon className="size-4" data-dw-icon="violet" />
                      <div>
                        <strong>
                          <T>Worktrees & Runtimes</T>
                        </strong>
                        <small>
                          <T>Isolated worker environments and cleanup policies</T>
                        </small>
                      </div>
                      <ArrowUpRightIcon className="size-4 opacity-60" />
                    </button>

                    <button
                      type="button"
                      data-dw-engine-card=""
                      onClick={() => openEngineRoute("/settings/connections")}
                    >
                      <PlugIcon className="size-4" data-dw-icon="indigo" />
                      <div>
                        <strong>
                          <T>Connections & Remote Relay</T>
                        </strong>
                        <small>
                          <T>Pair remote machines, Tailscale, and cloud boxes</T>
                        </small>
                      </div>
                      <ArrowUpRightIcon className="size-4 opacity-60" />
                    </button>

                    <button
                      type="button"
                      data-dw-engine-card=""
                      onClick={() => openEngineRoute("/settings/general")}
                    >
                      <SlidersHorizontalIcon className="size-4 opacity-70" />
                      <div>
                        <strong>
                          <T>All Advanced Engine Settings</T>
                        </strong>
                        <small>
                          <T>Open the full T3 backend settings drawer</T>
                        </small>
                      </div>
                      <ArrowUpRightIcon className="size-4 opacity-60" />
                    </button>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
