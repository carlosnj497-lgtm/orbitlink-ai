import { afterEach, describe, expect, it, vi } from "vitest";
import { isChunkLoadError, reloadOnChunkError } from "./chunk-recovery";

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

  it("recarrega uma vez e não entra em laço", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    expect(reloadOnChunkError(chunkError())).toBe(true);
    expect(reloadOnChunkError(chunkError())).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnChunkError(new Error("outro"))).toBe(false);
  });
});
