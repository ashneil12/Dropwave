import { useId } from "react";

const palette = [
  ["#8f7ae8", "#5d47b8"],
  ["#e87a8f", "#b84a63"],
  ["#e8b45a", "#b07f2e"],
  ["#4ec4b0", "#2a8577"],
  ["#6ec87a", "#3d8f4d"],
  ["#6ea8e8", "#3a6db8"],
  ["#9aa2b8", "#5d6680"],
];

export function BotAvatar({ seed = 0, size = 26 }: { seed?: number; size?: number }) {
  const gradient = useId();
  const [top, bottom] = palette[seed % palette.length] ?? palette[0]!;
  const gap = 14 + (seed % 2) * 3;
  const eyeY = 46 + (seed % 3) * 2;
  const mouth =
    seed % 3 === 0 ? "M 42 66 Q 50 70 58 66" : seed % 3 === 1 ? "M 44 66 L 56 66" : null;
  return (
    <svg
      data-dropwave-avatar=""
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
      </defs>
      <rect
        x="3"
        y="3"
        width="94"
        height="94"
        rx="26"
        fill={`url(#${gradient})`}
        stroke="var(--dw-avatar-edge)"
        strokeWidth="2"
      />
      <rect x="6" y="5" width="88" height="40" rx="22" fill="var(--dw-avatar-sheen)" />
      {[50 - gap, 50 + gap].map((x) => (
        <g key={x}>
          <circle cx={x} cy={eyeY} r="7" fill="var(--dw-avatar-ink)" />
          <circle cx={x + 2.5} cy={eyeY - 2.5} r="2.2" fill="var(--dw-avatar-glint)" />
        </g>
      ))}
      {mouth ? (
        <path
          d={mouth}
          stroke="var(--dw-avatar-ink)"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
      ) : null}
    </svg>
  );
}
