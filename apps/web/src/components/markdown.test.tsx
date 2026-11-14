import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

const ANSWER = `**Status da sua Starlink**

- **Disponibilidade:** indisponível
- **Ferramenta:** \`get_starlink_status\`

### Interpretação
- A antena não está acessível.

### Hipóteses
1. Problema de alimentação.
2. Rede local sem rota até a antena.

---

| Métrica | Valor |
|---|---|
| Latência | 32 ms |

_(resposta truncada)_`;

describe("Markdown", () => {
  it("renderiza títulos, listas, tabelas e código sem deixar a sintaxe crua", () => {
    const { container } = render(<Markdown text={ANSWER} />);
    const text = container.textContent ?? "";
    for (const raw of ["###", "---", "**", "`", "| Métrica"]) expect(text).not.toContain(raw);

    expect(screen.getByRole("heading", { name: "Interpretação" })).toBeInTheDocument();
    expect(container.querySelector("ol")?.children).toHaveLength(2);
    expect(container.querySelector("hr")).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Métrica" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "32 ms" })).toBeInTheDocument();
    expect(screen.getByText("get_starlink_status").tagName).toBe("CODE");
    expect(screen.getByText("Disponibilidade:").tagName).toBe("STRONG");
    expect(screen.getByText("(resposta truncada)").tagName).toBe("EM");
  });

  it("não trata sublinhados dentro de identificadores como itálico", () => {
    const { container } = render(<Markdown text="consultas: get_esp32_telemetry e get_usage_summary" />);
    expect(container.querySelector("em")).toBeNull();
    expect(container.textContent).toBe("consultas: get_esp32_telemetry e get_usage_summary");
  });

  it("nunca injeta HTML bruto", () => {
    const { container } = render(<Markdown text={'<img src=x onerror="alert(1)"> **ok**'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });
});
