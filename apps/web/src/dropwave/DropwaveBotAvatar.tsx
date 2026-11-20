export type BotAvatarStatus = "working" | "waiting" | "needs-you" | "idle" | "none";

const PALETTES = [
  { bg: "linear-gradient(145deg, #2b2d47, #1c1d30)", accent: "#a8acff", eye: "#eef0ff" },
  { bg: "linear-gradient(145deg, #1d353a, #132227)", accent: "#6ee7c8", eye: "#e6fff8" },
  { bg: "linear-gradient(145deg, #352742, #22192d)", accent: "#cfa8ff", eye: "#f6ecff" },
  { bg: "linear-gradient(145deg, #2c3128, #1b1f18)", accent: "#a3e67e", eye: "#f0ffe6" },
  { bg: "linear-gradient(145deg, #3a2b28, #241a18)", accent: "#ffb899", eye: "#fff1eb" },
] as const;

function hashSeed(input: string | number): number {
  if (typeof input === "number") return Math.abs(Math.floor(input));
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Minimalist expressive geometric bot face avatar.
 * Gives every Lead & Specialist bot an unmistakable personality face without neon slop.
 */
export function DropwaveBotAvatar({
  name,
  seed,
  role,
  size = "md",
  status = "none",
}: {
  name: string;
  seed?: number | undefined;
  role?: "lead" | "qa" | "growth" | "specialist" | undefined;
  size?: "sm" | "md" | "lg";
  status?: BotAvatarStatus;
}) {
  const hash = hashSeed(seed ?? name);
  const paletteIndex =
    role === "lead" ? 0 : role === "qa" ? 1 : role === "growth" ? 3 : hash % PALETTES.length;
  const palette = PALETTES[paletteIndex]!;
  const variant = role === "lead" ? 0 : role === "qa" ? 1 : role === "growth" ? 2 : hash % 4;

  return (
    <span data-dw-bot-face={size} style={{ background: palette.bg }} aria-hidden="true">
      <svg viewBox="0 0 36 36" width="100%" height="100%" fill="none">
        {/* Subtle top antenna / crown bar */}
        <rect x="14" y="5" width="8" height="2" rx="1" fill={palette.accent} opacity="0.7" />
        {/* Head visor */}
        <rect
          x="6.5"
          y="9.5"
          width="23"
          height="17.5"
          rx="6.5"
          fill="var(--background)"
          fillOpacity="0.62"
          stroke={palette.accent}
          strokeOpacity="0.48"
          strokeWidth="1.2"
        />

        {variant === 0 ? (
          /* Lead: calm focused twin rounded eyes + serene smile */
          <>
            <rect x="11.5" y="14.5" width="3.8" height="5" rx="1.9" fill={palette.eye} />
            <rect x="20.7" y="14.5" width="3.8" height="5" rx="1.9" fill={palette.eye} />
            <path
              d="M14.5 22.6C16.2 23.8 19.8 23.8 21.5 22.6"
              stroke={palette.accent}
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </>
        ) : variant === 1 ? (
          /* QA: analytical twin optics + precision dash mouth */
          <>
            <circle cx="13.8" cy="17.5" r="2.7" stroke={palette.eye} strokeWidth="1.5" />
            <circle cx="13.8" cy="17.5" r="0.9" fill={palette.accent} />
            <circle cx="22.2" cy="17.5" r="2.7" stroke={palette.eye} strokeWidth="1.5" />
            <circle cx="22.2" cy="17.5" r="0.9" fill={palette.accent} />
            <line
              x1="15.5"
              y1="22.8"
              x2="20.5"
              y2="22.8"
              stroke={palette.accent}
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </>
        ) : variant === 2 ? (
          /* Growth / Creative: bright asymmetric expressive eyes + upbeat curve */
          <>
            <circle cx="13.5" cy="17.2" r="2.3" fill={palette.eye} />
            <path
              d="M19.8 17.6C20.6 15.8 23.2 15.8 24 17.6"
              stroke={palette.eye}
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="M14.2 22.2C16.4 24.1 19.6 24.1 21.8 22.2"
              stroke={palette.accent}
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </>
        ) : (
          /* Builder / Specialist: crisp visor light strip + focused dots */
          <>
            <rect x="11" y="15.8" width="5.2" height="3.2" rx="1.6" fill={palette.eye} />
            <rect x="19.8" y="15.8" width="5.2" height="3.2" rx="1.6" fill={palette.eye} />
            <circle cx="18" cy="22.8" r="1.2" fill={palette.accent} />
          </>
        )}
      </svg>

      {status !== "none" ? <span data-dw-face-dot={status} /> : null}
    </span>
  );
}
