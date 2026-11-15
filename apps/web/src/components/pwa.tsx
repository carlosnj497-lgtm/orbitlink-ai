"use client";

import { useEffect } from "react";

/** Registra o service worker (página offline do app instalado). Navegadores só permitem em HTTPS ou localhost. */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* sem service worker o painel funciona normalmente */
    });
  }, []);
  return null;
}
