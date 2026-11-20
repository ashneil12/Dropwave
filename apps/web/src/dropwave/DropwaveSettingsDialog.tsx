import type { DropwaveRiskLevel } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, msg, useGT, useMessages } from "gt-react";
import {
  ArrowUpRightIcon,
  CpuIcon,
  FolderGit2Icon,
  ImageIcon,
  KeyRoundIcon,
  PlugIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { ProviderSettingsPanel } from "../components/settings/ProviderSettingsPanel";
import { Dialog, DialogPopup } from "../components/ui/dialog";
import type { useDropwaveAppearance } from "./DropwaveToolbar";

type SettingsSection = "dropwave" | "providers" | "engine";

const PRESETS = [
  { key: "mountains", file: "mountains.jpg", label: msg("Mountains") },
  { key: "ocean", file: "ocean.jpg", label: msg("Ocean") },
  { key: "abstract", file: "abstract.jpg", label: msg("Abstract") },
  { key: "sunrise", file: "sunrise.jpg", label: msg("Sunrise") },
  { key: "dusk", file: "dusk.png", label: msg("Dusk") },
] as const;

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
  const navigate = useNavigate();
  const gt = useGT();
  const m = useMessages();
  const [section, setSection] = useState<SettingsSection>("dropwave");

  if (!open) return null;

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
                aria-current={section === "providers" ? "true" : undefined}
                onClick={() => setSection("providers")}
              >
                <KeyRoundIcon className="size-4" />
                <span>
                  <T>Providers & Models</T>
                </span>
              </button>

              <div data-dw-settings-divider="">
                <T>Advanced</T>
              </div>

              <button
                type="button"
                data-dw-settings-nav-item=""
                aria-current={section === "engine" ? "true" : undefined}
                onClick={() => setSection("engine")}
              >
                <CpuIcon className="size-4" />
                <span>
                  <T>T3 Engine & Advanced</T>
                </span>
              </button>
            </nav>
          </aside>

          <div data-dw-settings-main="">
            <header data-dw-settings-header="">
              <h2>
                {section === "dropwave" ? (
                  <T>Workspace & Look</T>
                ) : section === "providers" ? (
                  <T>Providers & Models</T>
                ) : (
                  <T>T3 Engine & Advanced</T>
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
                        <T>Glass blur</T>
                      </span>
                      <input
                        type="range"
                        min={0.3}
                        max={1.6}
                        step={0.05}
                        value={appearance.strength}
                        onChange={(e) => appearance.setStrength(e.currentTarget.valueAsNumber)}
                      />
                    </label>
                    <label data-dw-range-row="">
                      <span>
                        <T>Glass opacity</T>
                      </span>
                      <input
                        type="range"
                        min={0.24}
                        max={0.86}
                        step={0.02}
                        value={appearance.opacity}
                        onChange={(e) => appearance.setOpacity(e.currentTarget.valueAsNumber)}
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
                </>
              ) : section === "providers" ? (
                <div data-dw-embedded-providers="">
                  <ProviderSettingsPanel />
                </div>
              ) : (
                <section data-dw-settings-group="">
                  <h3>
                    <T>Underlying T3 Engine Settings</T>
                  </h3>
                  <p data-dw-settings-desc="">
                    <T>
                      Open the underlying engine screens when you need deep git worktree, project
                      defaults, or remote relay controls.
                    </T>
                  </p>

                  <div data-dw-engine-links="">
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
