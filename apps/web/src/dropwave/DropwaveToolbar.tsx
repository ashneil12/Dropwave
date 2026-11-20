import { Link } from "@tanstack/react-router";
import { ActivityIcon, ImageIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import * as Schema from "effect/Schema";

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { DropwaveNeeds } from "./DropwavePanels";
import { useDropwaveWorkspace } from "./workspaceContext";

const Wallpaper = Schema.Literals(["mountains", "ocean", "abstract", "sunrise", "dusk"]);
const wallpapers = {
  mountains: { file: "mountains.jpg", label: "Mountains" },
  ocean: { file: "ocean.jpg", label: "Ocean" },
  abstract: { file: "abstract.jpg", label: "Abstract" },
  sunrise: { file: "sunrise.jpg", label: "Sunrise" },
  dusk: { file: "dusk.png", label: "Dusk" },
} satisfies Record<typeof Wallpaper.Type, { file: string; label: string }>;

export function useDropwaveAppearance() {
  const [wallpaper, setWallpaper] = useLocalStorage("dropwave:wallpaper", "mountains", Wallpaper);
  const [storedStrength, setStrength] = useLocalStorage(
    "dropwave:glass-strength",
    1,
    Schema.Finite,
  );
  const strength = Math.min(1.6, Math.max(0.4, storedStrength));
  const style: React.CSSProperties & { "--dw-wallpaper": string; "--dw-glass": number } = {
    "--dw-wallpaper": `url("/dropwave/${wallpapers[wallpaper].file}")`,
    "--dw-glass": strength,
  };
  return { wallpaper, setWallpaper, strength, setStrength, style };
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
  const [needsOpen, setNeedsOpen] = useState(false);
  if (!workspace) return null;
  const count = workspace.needs.length;
  return (
    <div data-dropwave-toolbar="">
      <Popover open={needsOpen} onOpenChange={setNeedsOpen}>
        <PopoverTrigger
          data-dropwave-header-button=""
          data-dropwave-needs={count ? "pending" : "clear"}
          aria-label="Needs you"
        >
          <span data-dropwave-needs-dot="" aria-hidden="true" />
          Needs you
          {count > 0 ? <span data-dropwave-count="">{count}</span> : null}
        </PopoverTrigger>
        <PopoverPopup width="md" align="end" padding="compact" data-dropwave-popover="">
          <DropwaveNeeds onOpenThread={() => setNeedsOpen(false)} />
        </PopoverPopup>
      </Popover>
      <Popover>
        <PopoverTrigger data-dropwave-chrome-button="" aria-label="Wallpaper and glass">
          <ImageIcon />
        </PopoverTrigger>
        <PopoverPopup
          width="md"
          align="end"
          data-dropwave-popover=""
          aria-label="Wallpaper and glass"
        >
          <div data-dropwave-appearance="">
            <span>Wallpaper</span>
            <div data-dropwave-wallpapers="" role="group" aria-label="Wallpapers">
              {Wallpaper.literals.map((key) => {
                const wall = wallpapers[key];
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={wall.label}
                    aria-pressed={appearance.wallpaper === key}
                    onClick={() => appearance.setWallpaper(key)}
                  >
                    <img src={`/dropwave/${wall.file}`} alt="" />
                  </button>
                );
              })}
            </div>
            <label>
              Glass strength
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
        aria-label="Activity"
        aria-pressed={activityOpen}
        onClick={toggleActivity}
      >
        <ActivityIcon />
      </button>
      <Link to="/settings/general" data-dropwave-chrome-button="" aria-label="Settings">
        <SettingsIcon />
      </Link>
    </div>
  );
}
