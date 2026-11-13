"use client";

import { useEffect, useState } from "react";

/** Horário atual (epoch s) atualizado periodicamente, sem chamadas impuras durante a renderização. */
export function useNow(intervalMs = 5000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now() / 1000);
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}
