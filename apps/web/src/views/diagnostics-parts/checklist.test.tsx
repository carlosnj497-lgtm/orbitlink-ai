import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CheckDetails, Checklist, ChecklistItem } from "./checklist";

it("expande o item no lugar e anuncia o estado", () => {
  render(
    <Checklist title="Verificações">
      <ChecklistItem state="warn" title="Perda alta à noite" summary="Fato registrado.">
        <CheckDetails rows={[{ label: "Evidência", value: "Dados do agente" }]} />
      </ChecklistItem>
      <ChecklistItem state="off" title="Roteador" summary="Opcional." />
    </Checklist>,
  );
  const btn = screen.getByRole("button", { name: /Perda alta à noite/ });
  expect(btn).toHaveAttribute("aria-expanded", "false");
  expect(btn).toHaveTextContent(/Estado: atenção/);
  expect(screen.queryByText("Dados do agente")).not.toBeInTheDocument();
  fireEvent.click(btn);
  expect(btn).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Dados do agente")).toBeInTheDocument();
  // item sem detalhes não vira botão
  expect(screen.queryByRole("button", { name: /Roteador/ })).not.toBeInTheDocument();
  expect(screen.getAllByText("pulado").length).toBeGreaterThan(0);
});
