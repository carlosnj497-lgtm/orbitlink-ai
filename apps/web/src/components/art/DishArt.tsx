import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * Ilustração original de uma antena plana sobre suporte (não é imagem oficial nem marca da Starlink/SpaceX).
 * `dim` deixa o desenho apagado para estados sem comunicação.
 */
export function DishArt({ className, dim = false }: { className?: string; dim?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg viewBox="0 0 220 150" className={cn("shrink-0", dim && "opacity-55 saturate-50 animate-dish-seek", className)} aria-hidden>
      <defs>
        <linearGradient id={`${id}-face`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#dbe6f7" />
          <stop offset="1" stopColor="#a9bbd9" />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fa2c4" />
          <stop offset="1" stopColor="#566a8f" />
        </linearGradient>
        <linearGradient id={`${id}-leg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b4d70" />
          <stop offset="1" stopColor="#141f36" />
        </linearGradient>
        <radialGradient id={`${id}-shadow`}>
          <stop offset="0" stopColor="#000" stopOpacity="0.55" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="124" cy="136" rx="62" ry="9" fill={`url(#${id}-shadow)`} />
      {/* suporte */}
      <path d="M108 86 L132 80 L140 128 Q141 133 136 133 L118 134 Q113 134 113 129 Z" fill={`url(#${id}-leg)`} />
      <path d="M96 132 Q124 124 152 131 L152 136 Q124 141 96 137 Z" fill="#1b2944" />
      {/* espessura da placa */}
      <path d="M18 46 L40 100 Q42 105 47 104 L196 70 Q201 68 200 63 L198 58 L46 94 Z" fill={`url(#${id}-edge)`} />
      {/* face da placa */}
      <path
        d="M24 36 Q19 37 21 42 L42 92 Q44 97 49 96 L196 62 Q201 60 199 55 L172 10 Q170 6 165 7 Z"
        fill={`url(#${id}-face)`}
        stroke="#f8fafc"
        strokeOpacity="0.7"
        strokeWidth="1"
      />
      <path d="M36 44 L164 16" stroke="#ffffff" strokeOpacity="0.75" strokeWidth="2" strokeLinecap="round" />
      <path d="M52 86 L188 56" stroke="#7d91b6" strokeOpacity="0.35" strokeWidth="1" />
    </svg>
  );
}
