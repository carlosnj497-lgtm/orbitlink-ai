import { useId } from "react";

// Estrelas determinísticas (sem Math.random: o SVG é renderizado no servidor e no cliente).
const STARS = Array.from({ length: 46 }, (_, i) => {
  const x = (i * 263 + 71) % 1200;
  const y = (i * 97 + 13) % 150;
  return { x, y, r: i % 7 === 0 ? 1.4 : i % 3 === 0 ? 1 : 0.7, o: 0.25 + ((i * 37) % 60) / 100 };
});

const NODES: [number, number][] = [
  [905, 58], [968, 30], [1042, 66], [1108, 34], [1162, 84], [1010, 112], [1088, 126], [930, 128],
];
const LINKS: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5], [5, 6], [6, 4], [0, 7], [7, 5], [1, 3]];

/** Fundo do banner principal: horizonte da Terra em azul de missão, brilho atmosférico e malha orbital. Arte original, estática. */
export function HeroArt() {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg viewBox="0 0 1200 240" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#03070d" />
          <stop offset="0.5" stopColor="#010306" />
          <stop offset="1" stopColor="#000000" />
        </linearGradient>
        <radialGradient id={`${id}-sun`} cx="0.5" cy="1" r="1">
          <stop offset="0" stopColor="#008cff" stopOpacity="0.34" />
          <stop offset="0.35" stopColor="#005288" stopOpacity="0.2" />
          <stop offset="1" stopColor="#005288" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-earth`} cx="0.4" cy="0.2" r="0.9">
          <stop offset="0" stopColor="#0a4a78" />
          <stop offset="0.45" stopColor="#04223a" />
          <stop offset="1" stopColor="#000000" />
        </radialGradient>
        <radialGradient id={`${id}-atmo`}>
          <stop offset="0.9" stopColor="#38bdf8" stopOpacity="0" />
          <stop offset="0.955" stopColor="#38bdf8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0.16" stopColor="#000000" stopOpacity="0" />
          <stop offset="0.36" stopColor="#000000" stopOpacity="0.72" />
          <stop offset="0.7" stopColor="#000000" stopOpacity="0.6" />
          <stop offset="0.9" stopColor="#000000" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="1200" height="240" fill={`url(#${id}-sky)`} />
      {STARS.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#e0f2fe" opacity={s.o} />
      ))}
      {/* brilho atmosférico atrás da antena */}
      <ellipse cx="170" cy="240" rx="420" ry="190" fill={`url(#${id}-sun)`} />
      <path d="M0 240 L0 196 L48 178 L96 200 L150 168 L214 204 L262 188 L330 214 L420 226 L420 240 Z" fill="#05080d" />
      <path d="M0 240 L0 214 L70 204 L140 222 L230 212 L330 232 L470 240 Z" fill="#000000" />
      {/* Terra */}
      <circle cx="1010" cy="640" r="470" fill={`url(#${id}-atmo)`} />
      <circle cx="1010" cy="640" r="436" fill={`url(#${id}-earth)`} />
      <g fill="#e6e8eb" opacity="0.55">
        <circle cx="842" cy="232" r="1.1" />
        <circle cx="870" cy="222" r="0.9" />
        <circle cx="902" cy="216" r="1.2" />
        <circle cx="948" cy="210" r="0.9" />
        <circle cx="996" cy="208" r="1.3" />
        <circle cx="1034" cy="210" r="0.9" />
        <circle cx="1082" cy="214" r="1.1" />
        <circle cx="1126" cy="222" r="1" />
        <circle cx="1168" cy="232" r="1.2" />
      </g>
      {/* malha orbital */}
      <g stroke="#38bdf8" strokeWidth="0.8" opacity="0.4" fill="none">
        {LINKS.map(([a, b], i) => (
          <path key={i} d={`M${NODES[a][0]} ${NODES[a][1]} L${NODES[b][0]} ${NODES[b][1]}`} />
        ))}
        <path d="M760 190 Q980 20 1200 96" strokeOpacity="0.55" />
        <path d="M800 220 Q1010 70 1200 150" strokeOpacity="0.35" />
      </g>
      {NODES.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 2.4 : 1.7} fill="#7dd3fc" opacity="0.85" />
      ))}
      <rect width="1200" height="240" fill={`url(#${id}-fade)`} />
    </svg>
  );
}
