"use client";

import { createContext, useContext, type ReactNode } from "react";

const DemoContext = createContext(false);

/** Ativado SOMENTE pela rota /demo. Nunca é ligado silenciosamente no modo real. */
export function DemoProvider({ children }: { children: ReactNode }) {
  return <DemoContext value={true}>{children}</DemoContext>;
}

export function useDemo(): boolean {
  return useContext(DemoContext);
}

export function useBasePath(): string {
  return useDemo() ? "/demo" : "";
}
