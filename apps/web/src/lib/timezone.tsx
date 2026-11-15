"use client";

import type { AgentInfo } from "@astryon/shared";
import { useEffect, useSyncExternalStore } from "react";
import { useAgent } from "./api";
import { DEFAULT_TZ, displayTimezone, restoreDisplayTimezone, setDisplayTimezone, subscribeDisplayTimezone } from "./format";

/** Fuso de exibição atual; re-renderiza quando o fuso do agente chega ou muda. */
export function useDisplayTimezone(): string {
  return useSyncExternalStore(subscribeDisplayTimezone, displayTimezone, () => DEFAULT_TZ);
}

/** Alinha a formatação de datas do painel ao fuso configurado no agente (ASTRYON_TIMEZONE). */
export function TimezoneSync() {
  const { data } = useAgent<AgentInfo>("agent", { refetchInterval: 30_000 });
  useEffect(() => restoreDisplayTimezone(), []);
  useEffect(() => {
    setDisplayTimezone(data?.timezone);
  }, [data?.timezone]);
  return null;
}
