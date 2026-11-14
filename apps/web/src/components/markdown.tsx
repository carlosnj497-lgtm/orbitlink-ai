import { Fragment, type ReactNode } from "react";

/*
 * Renderização segura de Markdown para respostas do assistente: só gera elementos React (nunca HTML bruto),
 * cobrindo o que os modelos costumam produzir — títulos, listas (inclusive numeradas e aninhadas), tabelas,
 * citações, blocos de código, linhas horizontais, negrito, itálico e `código`.
 */

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\s][^*\n]*\*|(?<![\p{L}\p{N}_])_[^_\n]+_(?![\p{L}\p{N}_]))/gu;

export function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((p, i) => {
    if (!p) return null;
    if ((p.startsWith("**") && p.endsWith("**")) || (p.startsWith("__") && p.endsWith("__"))) {
      return p.length > 4 ? <strong key={i}>{inline(p.slice(2, -2))}</strong> : p;
    }
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
      return (
        <code key={i} className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[0.85em]">
          {p.slice(1, -1)}
        </code>
      );
    }
    if (((p.startsWith("*") && p.endsWith("*")) || (p.startsWith("_") && p.endsWith("_"))) && p.length > 2) {
      return (
        <em key={i} className="text-fg-muted">
          {inline(p.slice(1, -1))}
        </em>
      );
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

interface ListItem {
  depth: number;
  ordered: boolean;
  start: number;
  text: string;
}

function renderList(items: ListItem[], key: string): ReactNode {
  // Agrupa itens por profundidade relativa ao primeiro item, aninhando os mais indentados.
  const base = items[0].depth;
  const out: { item: ListItem; children: ListItem[] }[] = [];
  for (const it of items) {
    if (it.depth > base && out.length) out[out.length - 1].children.push(it);
    else out.push({ item: it, children: [] });
  }
  const ordered = items[0].ordered;
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag key={key} start={ordered ? items[0].start : undefined} className={`space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-fg-subtle`}>
      {out.map(({ item, children }, i) => (
        <li key={i}>
          {inline(item.text)}
          {children.length > 0 && <div className="mt-1">{renderList(children, `${key}-${i}`)}</div>}
        </li>
      ))}
    </Tag>
  );
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: ListItem[] = [];

  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(
        <p key={k}>
          {para.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {inline(l)}
            </Fragment>
          ))}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push(renderList(list, `l${blocks.length}`));
      list = [];
    }
  };
  const flush = () => {
    flushPara();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push(
        <pre key={`c${blocks.length}`} className="overflow-x-auto rounded-lg border border-border bg-bg p-3 font-mono text-xs">
          {code.join("\n")}
        </pre>,
      );
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      const lvl = h[1].length;
      blocks.push(
        <p key={`h${blocks.length}`} role="heading" aria-level={Math.min(lvl + 2, 6)} className={lvl <= 2 ? "pt-1 text-base font-semibold text-fg" : "pt-1 font-semibold text-fg"}>
          {inline(h[2])}
        </p>,
      );
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push(<hr key={`r${blocks.length}`} className="my-1 border-border" />);
      continue;
    }
    if (line.trimStart().startsWith("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith("|"); i++) rows.push(cells(lines[i]));
      i--;
      blocks.push(
        <div key={`t${blocks.length}`} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j} className="border-b border-border-strong px-2 py-1.5 font-semibold text-fg-muted">
                    {inline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-border last:border-0">
                  {head.map((_, j) => (
                    <td key={j} className="px-2 py-1.5 align-top tabular">
                      {inline(r[j] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      const quote: string[] = [];
      for (; i < lines.length && /^\s*>\s?/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, "").trimEnd());
      i--;
      blocks.push(
        <blockquote key={`q${blocks.length}`} className="border-l-2 border-border-strong pl-3 text-fg-muted">
          {quote.map((q, j) => (
            <p key={j}>{inline(q)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }
    const b = BULLET.exec(line);
    const o = b ? null : ORDERED.exec(line);
    if (b || o) {
      flushPara();
      const item: ListItem = b
        ? { depth: b[1].length, ordered: false, start: 1, text: b[2] }
        : { depth: o![1].length, ordered: true, start: Number(o![2]), text: o![3] };
      // Um novo tipo de lista no nível de base começa outra lista.
      if (list.length && item.depth <= list[0].depth && item.ordered !== list[0].ordered) flushList();
      list.push(item);
      continue;
    }
    if (list.length && /^\s{2,}\S/.test(raw)) {
      // Continuação de um item de lista.
      list[list.length - 1].text += " " + line.trim();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flush();

  return <div className="space-y-2 text-sm leading-relaxed">{blocks}</div>;
}
