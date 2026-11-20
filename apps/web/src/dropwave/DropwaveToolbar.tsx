import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { T, msg, useGT, useMessages } from "gt-react";
import { ActivityIcon, ImageIcon, SettingsIcon, UploadIcon } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { DropwaveNeeds } from "./DropwavePanels";
import { useDropwaveWorkspace } from "./workspaceContext";

const Wallpaper = Schema.Literals(["mountains", "ocean", "abstract", "sunrise", "dusk", "custom"]);
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
  const [wallpaper, setWallpaper] = useLocalStorage("dropwave:wallpaper", "mountains", Wallpaper);
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
    customWallpaper,
    setCustomWallpaper,
    strength,
    setStrength,
    style,
  };
}

export function DropwaveToolbar({
  appearance,
  activityOpen,
  toggleActivity,
}: {
  appearance: ReturnType<typeof useDropwaveAppearance>;
  activityOpen: boolean;
  toggleActivity: () => void;
}) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const m = useMessages();
  const [needsOpen, setNeedsOpen] = useState(false);
  if (!workspace) return null;
  const count = workspace.needs.length;
  return (
    <div data-dropwave-toolbar="">
      <Popover open={needsOpen} onOpenChange={setNeedsOpen}>
        <PopoverTrigger
          data-dropwave-header-button=""
          data-dropwave-needs={count ? "pending" : "clear"}
          aria-label={gt("Needs you")}
        >
          <span data-dropwave-needs-dot="" aria-hidden="true" />
          <T>Needs you</T>
          {count > 0 ? <span data-dropwave-count="">{count}</span> : null}
        </PopoverTrigger>
        <PopoverPopup width="md" align="end" padding="compact" data-dropwave-popover="">
          <DropwaveNeeds onOpenThread={() => setNeedsOpen(false)} />
        </PopoverPopup>
      </Popover>
      <Popover>
        <PopoverTrigger data-dropwave-chrome-button="" aria-label={gt("Wallpaper and glass")}>
          <ImageIcon />
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
        data-dropwave-chrome-button=""
        type="button"
        aria-label={gt("Activity")}
        aria-pressed={activityOpen}
        onClick={toggleActivity}
      >
        <ActivityIcon />
      </button>
      <Link to="/settings/general" data-dropwave-chrome-button="" aria-label={gt("Settings")}>
        <SettingsIcon />
      </Link>
    </div>
  );
}
