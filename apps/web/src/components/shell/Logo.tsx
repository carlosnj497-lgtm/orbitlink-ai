import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * Símbolo do ASTRYON (desenho original — o projeto não usa marcas da Starlink/SpaceX): o horizonte de um
 * planeta, uma órbita em arco e o satélite com brilho. Os ids dos degradês vêm de useId porque o logo aparece
 * mais de uma vez na página (barra lateral oculta + menu móvel); ids repetidos faziam o Chrome usar o degradê
 * de dentro do elemento oculto e o símbolo sumia, sobrando só o ponto do satélite.
 */
export function Logo({ className }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const tile = `${id}-tile`;
  const planet = `${id}-planet`;
  const orbit = `${id}-orbit`;
  const glow = `${id}-glow`;
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#10151d" />
          <stop offset="1" stopColor="#000000" />
        </linearGradient>
        <linearGradient id={planet} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#008cff" stopOpacity="0.15" />
          <stop offset="0.5" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#008cff" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id={orbit} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#38bdf8" stopOpacity="0" />
          <stop offset="0.55" stopColor="#38bdf8" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
        <radialGradient id={glow}>
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#7dd3fc" stopOpacity="0.8" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0.5" y="0.5" width="31" height="31" rx="6" fill={`url(#${tile})`} stroke="#38bdf8" strokeOpacity="0.28" />
      {/* horizonte do planeta */}
      <path d="M3.5 27.5C8 22.6 23.9 22.6 28.5 27.5" fill="none" stroke={`url(#${planet})`} strokeWidth="1.6" strokeLinecap="round" />
      {/* órbita em arco, afinando até o satélite */}
      <path d="M5 21.5C9.5 13.5 17.5 8.2 25.2 7.6" fill="none" stroke={`url(#${orbit})`} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M8.2 22.6C12.8 16.4 18.8 12.6 24.6 11.4" fill="none" stroke="#38bdf8" strokeOpacity="0.35" strokeWidth="0.9" strokeLinecap="round" />
      {/* satélite */}
      <circle cx="25.6" cy="7.5" r="4.6" fill={`url(#${glow})`} />
      <circle cx="25.6" cy="7.5" r="1.7" fill="#f8fafc" />
    </svg>
  );
}
