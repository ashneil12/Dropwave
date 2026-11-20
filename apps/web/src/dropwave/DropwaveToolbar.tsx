import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { T, msg, useGT, useMessages } from "gt-react";
import { Columns3Icon, ImageIcon, Maximize2Icon, SettingsIcon, UploadIcon } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { DropwaveNeeds } from "./DropwavePanels";
import type { SampleVenture } from "./sampleData";
import { useDropwaveWorkspace } from "./workspaceContext";

const WallpaperSchema = Schema.Literals([
  "mountains",
  "ocean",
  "abstract",
  "sunrise",
  "dusk",
  "custom",
]);
const presetKeys = ["mountains", "ocean", "abstract", "sunrise", "dusk"] as const;
const wallpapers = {
  mountains: { file: "mountains.jpg", label: msg("Mountains") },
  ocean: { file: "ocean.jpg", label: msg("Ocean") },
  abstract: { file: "abstract.jpg", label: msg("Abstract") },
  sunrise: { file: "sunrise.jpg", label: msg("Sunrise") },
  dusk: { file: "dusk.png", label: msg("Dusk") },
} as const;
const CustomWallpaperSchema = Schema.NullOr(Schema.String);

export function useDropwaveAppearance() {
  const [wallpaper, setWallpaper] = useLocalStorage(
    "dropwave:wallpaper",
    "mountains",
    WallpaperSchema,
  );
  const [customWallpaper, setCustomWallpaper] = useLocalStorage(
    "dropwave:custom-wallpaper",
    null,
    CustomWallpaperSchema,
  );
  const [storedStrength, setStrength] = useLocalStorage(
    "dropwave:glass-strength",
    1,
    Schema.Finite,
  );
  const strength = Math.min(1.6, Math.max(0.4, storedStrength));
  const bgUrl =
    wallpaper === "custom" && customWallpaper
      ? `url("${customWallpaper}")`
      : `url("/dropwave/${wallpapers[wallpaper === "custom" ? "mountains" : wallpaper].file}")`;
  const style: React.CSSProperties & { "--dw-wallpaper": string; "--dw-glass": number } = {
    "--dw-wallpaper": bgUrl,
    "--dw-glass": strength,
  };
  return {
    wallpaper,
    setWallpaper,
    setCustomWallpaper,
    strength,
    setStrength,
    style,
  };
}

export function DropwaveToolbar({
  appearance,
  ventures,
  totalNeedsCount,
  onSelectPreviewReview,
}: {
  appearance: ReturnType<typeof useDropwaveAppearance>;
  ventures: ReadonlyArray<SampleVenture>;
  totalNeedsCount: number;
  onSelectPreviewReview: (ventureId: string, reviewId: string) => void;
}) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const m = useMessages();
  const [needsOpen, setNeedsOpen] = useState(false);

  if (!workspace) return null;

  return (
    <div data-dw-topbar-right="">
      <div data-dw-mode-switch="" role="group" aria-label={gt("Workspace data mode")}>
        <button
          type="button"
          aria-pressed={workspace.mode === "preview"}
          onClick={() => workspace.setMode("preview")}
        >
          <T>Preview</T>
        </button>
        <button
          type="button"
          aria-pressed={workspace.mode === "live"}
          onClick={() => {
            workspace.setMode("live");
            if (!workspace.lead) workspace.setMainView("setup");
          }}
        >
          <T>Live</T>
        </button>
      </div>

      <Popover open={needsOpen} onOpenChange={setNeedsOpen}>
        <PopoverTrigger
          type="button"
          data-dw-needs-pill={totalNeedsCount > 0 ? "urgent" : "clear"}
          aria-label={gt("Needs you")}
        >
          <span
            data-dw-dot={totalNeedsCount > 0 ? "coral" : "dim"}
            data-pulse={totalNeedsCount > 0 ? "" : undefined}
          />
          <span>
            <T>Needs you</T>
          </span>
          {totalNeedsCount > 0 ? <span data-dw-needs-count="">{totalNeedsCount}</span> : null}
        </PopoverTrigger>
        <PopoverPopup width="md" align="end" padding="compact" data-dropwave-popover="">
          {workspace.mode === "preview" ? (
            <div data-dw-preview-needs-pop="">
              {ventures.flatMap((v) =>
                v.reviews.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    data-dw-pop-review=""
                    onClick={() => {
                      setNeedsOpen(false);
                      onSelectPreviewReview(v.id, r.id);
                    }}
                  >
                    <strong>
                      {v.name}: {r.title}
                    </strong>
                    <small>{r.summary}</small>
                  </button>
                )),
              )}
              {totalNeedsCount === 0 ? (
                <p data-dw-card-empty="">
                  <T>Nothing needs you right now.</T>
                </p>
              ) : null}
            </div>
          ) : (
            <DropwaveNeeds onOpenThread={() => setNeedsOpen(false)} />
          )}
        </PopoverPopup>
      </Popover>

      <Popover>
        <PopoverTrigger type="button" data-dw-top-icon="" aria-label={gt("Wallpaper and glass")}>
          <ImageIcon className="size-4" />
        </PopoverTrigger>
        <PopoverPopup
          width="md"
          align="end"
          data-dropwave-popover=""
          aria-label={gt("Wallpaper and glass")}
        >
          <div data-dropwave-appearance="">
            <span>
              <T>Wallpaper</T>
            </span>
            <div data-dropwave-wallpapers="" role="group" aria-label={gt("Wallpapers")}>
              {presetKeys.map((key) => {
                const wall = wallpapers[key];
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={m(wall.label)}
                    aria-pressed={appearance.wallpaper === key}
                    onClick={() => appearance.setWallpaper(key)}
                  >
                    <img src={`/dropwave/${wall.file}`} alt="" />
                  </button>
                );
              })}
            </div>
            <label data-dropwave-upload-wall="">
              <UploadIcon />
              <span>
                <T>Use your own image</T>
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
            <label>
              <T>Glass strength</T>
              <input
                type="range"
                min={0.4}
                max={1.6}
                step={0.05}
                value={appearance.strength}
                onChange={(event) => appearance.setStrength(event.currentTarget.valueAsNumber)}
              />
            </label>
          </div>
        </PopoverPopup>
      </Popover>

      <button
        type="button"
        data-dw-top-icon=""
        aria-label={workspace.focusMode ? gt("Show side panels") : gt("Focus chat")}
        aria-pressed={workspace.focusMode}
        onClick={() => workspace.setFocusMode(!workspace.focusMode)}
      >
        {workspace.focusMode ? (
          <Columns3Icon className="size-4" />
        ) : (
          <Maximize2Icon className="size-4" />
        )}
      </button>

      <Link to="/settings/general" data-dw-top-icon="" aria-label={gt("Settings")}>
        <SettingsIcon className="size-4" />
      </Link>

      <span data-dw-founder-chip="" aria-hidden="true">
        S
      </span>
    </div>
  );
}
