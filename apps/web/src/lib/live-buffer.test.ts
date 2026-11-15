import type { StatusResponse } from "@astryon/shared";
import { afterEach, describe, expect, it } from "vitest";
import { LIVE_MAX, pushReading, resetReadings, toReading } from "./live-buffer";

function status(observed: string, down: number | null, over: Partial<{ stale: boolean }> = {}): StatusResponse {
  return {
    available: true, dish_reachable: true, age_s: 0, stale: over.stale ?? false,
    status: {
      observed_at: observed, origin: "grpc", state: "conectada", state_reason: null,
      device: { terminal_key: null, hardware_version: null, software_version: null, board_rev: null, bootcount: null },
      metrics: { downlink_mbps: { value: down, source: "real" }, currently_obstructed: { value: false, source: "real" } },
      alerts: [], outage: null, fields_present: [], fields_missing: [],
    },
  };
}

afterEach(() => resetReadings());

describe("leituras ao vivo da sessão", () => {
  it("só aceita leituras reais e atuais", () => {
    expect(toReading(undefined)).toBeNull();
    expect(toReading({ available: false, dish_reachable: false, reason: "x", error_kind: null })).toBeNull();
    expect(toReading(status("2026-11-14T12:00:00Z", 10, { stale: true }))).toBeNull();
    expect(toReading(status("2026-11-14T12:00:00Z", 10))).toMatchObject({ down: 10, lat: null, obstructed: false });
  });

  it("não duplica a mesma leitura e limita o tamanho", async () => {
    const { useLiveReadings } = await import("./live-buffer");
    expect(useLiveReadings).toBeTypeOf("function");
    const t0 = Date.parse("2026-11-14T12:00:00Z");
    for (let i = 0; i < LIVE_MAX + 20; i++) {
      const iso = new Date(t0 + i * 10_000).toISOString();
      pushReading("k", status(iso, i));
      pushReading("k", status(iso, i)); // repetida (SSE + polling)
    }
    pushReading("k", status(new Date(t0).toISOString(), 999)); // fora de ordem
    // a leitura mais antiga mantida é a de índice 20
    const { renderHook } = await import("@testing-library/react");
    const { result } = renderHook(() => useLiveReadings("k", undefined, false));
    expect(result.current).toHaveLength(LIVE_MAX);
    expect(result.current[0].down).toBe(20);
    expect(result.current.at(-1)?.down).toBe(LIVE_MAX + 19);
  });
});
