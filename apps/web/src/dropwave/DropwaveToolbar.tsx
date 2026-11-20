import * as Schema from "effect/Schema";
import { useLocalStorage } from "../hooks/useLocalStorage";

const WallpaperSchema = Schema.Literals([
  "mountains",
  "ocean",
  "abstract",
  "sunrise",
  "dusk",
  "custom",
]);
const wallpapers = {
  mountains: { file: "mountains.jpg" },
  ocean: { file: "ocean.jpg" },
  abstract: { file: "abstract.jpg" },
  sunrise: { file: "sunrise.jpg" },
  dusk: { file: "dusk.png" },
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
