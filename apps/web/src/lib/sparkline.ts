/**
 * Geometria de minigráficos SVG (Ao vivo e cards do Dashboard). Valores nulos quebram a linha em trechos:
 * segundo sem leitura nunca vira zero.
 */
export interface SparkGeometry {
  /** Trechos contínuos, em coordenadas do viewBox. */
  runs: [number, number][][];
  /** Caminho da linha de um trecho. */
  line: (run: [number, number][]) => string;
  /** Caminho da área sob um trecho (fechada na base). */
  area: (run: [number, number][]) => string;
  x: (i: number) => number;
  y: (v: number) => number;
}

export function sparkGeometry(values: (number | null)[], width: number, height: number): SparkGeometry {
  const max = Math.max(0.001, ...values.map((v) => v ?? 0));
  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * width : width / 2);
  const y = (v: number) => height - 2 - (v / max) * (height - 5);
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length > 1) runs.push(run);
      run = [];
    } else run.push([x(i), y(v)]);
  });
  if (run.length > 1) runs.push(run);
  const line = (r: [number, number][]) => r.map(([px, py], j) => `${j ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join("");
  const area = (r: [number, number][]) => `${line(r)}L${r[r.length - 1][0].toFixed(1)} ${height}L${r[0][0].toFixed(1)} ${height}Z`;
  return { runs, line, area, x, y };
}

/** Média por balde (reduz séries longas a ~`buckets` pontos), ignorando nulos. */
export function bucketMeans<T>(data: T[], pick: (p: T) => number | null, buckets: number): (number | null)[] {
  const size = Math.max(1, Math.ceil(data.length / buckets));
  const out: (number | null)[] = [];
  for (let i = 0; i < data.length; i += size) {
    let sum = 0;
    let n = 0;
    for (const p of data.slice(i, i + size)) {
      const v = pick(p);
      if (v !== null) {
        sum += v;
        n++;
      }
    }
    out.push(n ? sum / n : null);
  }
  return out;
}
