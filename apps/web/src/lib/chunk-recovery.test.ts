import { afterEach, describe, expect, it, vi } from "vitest";
import { clearChunkReloadHistory, isChunkLoadError, reloadOnChunkError } from "./chunk-recovery";

function chunkError() {
  const e = new Error("Failed to load chunk /_next/static/chunks/abc.js from module 123");
  e.name = "ChunkLoadError";
  return e;
}

describe("recuperação de chunk antigo", () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("reconhece apenas erros de carregamento de chunk", () => {
    expect(isChunkLoadError(chunkError())).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: x.js"))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError("ChunkLoadError")).toBe(false);
  });

  it("recarrega automaticamente até o limite da janela", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    expect(reloadOnChunkError(chunkError())).toBe(true);
    expect(reloadOnChunkError(chunkError())).toBe(true);
    expect(reloadOnChunkError(chunkError())).toBe(true);
    expect(reload).toHaveBeenCalledTimes(3);
    // A quarta tentativa dentro da mesma janela é bloqueada.
    expect(reloadOnChunkError(chunkError())).toBe(false);
    expect(reload).toHaveBeenCalledTimes(3);
  });

  it("volta a permitir recarga após limpar o histórico", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    expect(reloadOnChunkError(chunkError())).toBe(true);
    expect(reloadOnChunkError(chunkError())).toBe(true);
    expect(reloadOnChunkError(chunkError())).toBe(true);
    expect(reloadOnChunkError(chunkError())).toBe(false);
    clearChunkReloadHistory();
    expect(reloadOnChunkError(chunkError())).toBe(true);
    expect(reload).toHaveBeenCalledTimes(4);
  });

  it("não recarrega para erros que não são de chunk", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    expect(reloadOnChunkError(new Error("outro"))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
