import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { Logo } from "./Logo";

it("cada logo usa ids de degradê próprios (logo duplicado não some no celular)", () => {
  const { container } = render(
    <>
      <div style={{ display: "none" }}>
        <Logo />
      </div>
      <Logo />
    </>,
  );
  const ids = [...container.querySelectorAll("[id]")].map((el) => el.id);
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);

  // Todas as referências url(#...) de cada SVG apontam para degradês do próprio SVG.
  for (const svg of container.querySelectorAll("svg")) {
    const own = new Set([...svg.querySelectorAll("[id]")].map((el) => el.id));
    const refs = [...svg.querySelectorAll("[fill],[stroke]")]
      .flatMap((el) => [el.getAttribute("fill"), el.getAttribute("stroke")])
      .map((v) => /^url\(#(.+)\)$/.exec(v ?? "")?.[1])
      .filter(Boolean);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(own.has(r!)).toBe(true);
  }
});
