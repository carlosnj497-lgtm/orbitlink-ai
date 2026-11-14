"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

// Usado quando o armazenamento está bloqueado (aba privada): a preferência vale só até recarregar.
const memory = new Map<string, boolean>();

function read(key: string): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v === "1";
  } catch {
    /* cai no valor em memória */
  }
  return memory.get(key) ?? false;
}

/** Preferência booleana por navegador (ex.: barra lateral recolhida). No servidor é sempre false. */
export function usePersistentFlag(key: string): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false,
  );
  const set = useCallback(
    (v: boolean) => {
      memory.set(key, v);
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {
        /* ignore */
      }
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}
