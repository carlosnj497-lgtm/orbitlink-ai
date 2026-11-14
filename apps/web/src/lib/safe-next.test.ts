import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

const ORIGIN = "https://painel.local";

describe("safeNext", () => {
  it("mantém caminhos internos", () => {
    expect(safeNext("/alertas", ORIGIN)).toBe("/alertas");
    expect(safeNext("/uso?periodo=mes#topo", ORIGIN)).toBe("/uso?periodo=mes#topo");
  });

  it.each([
    null,
    "",
    "alertas",
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "/\\/evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/\tevil",
    "/%0a",
  ])("recusa %j", (v) => {
    const out = safeNext(v, ORIGIN);
    expect(out.startsWith("/") && !out.startsWith("//")).toBe(true);
    expect(new URL(out, ORIGIN).origin).toBe(ORIGIN);
  });

  it("recusa barra invertida", () => {
    expect(safeNext("/\\evil.com", ORIGIN)).toBe("/");
  });
});
