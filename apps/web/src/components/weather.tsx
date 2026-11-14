"use client";

import type { GeocodeResult, WeatherHourly, WeatherStatus } from "@orbitlink/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Droplets, MapPin, Moon, Search, Sun, Trash2, Wind } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { QueryError, SourceBadge } from "@/components/domain";
import { hrefOf } from "@/components/shell/nav";
import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, Input, Skeleton } from "@/components/ui/primitives";
import { api, type ApiError, useAgent } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useBasePath, useDemo } from "@/lib/demo-context";
import { fmtAgo, fmtHM, fmtNumber } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { describeWeather, RAIN_META, type WeatherIcon } from "@/lib/weather";

const ICONS: Record<WeatherIcon, typeof Sun> = {
  sun: Sun,
  moon: Moon,
  "cloud-sun": CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

export function WeatherGlyph({ code, isDay = true, className }: { code: number | null | undefined; isDay?: boolean; className?: string }) {
  const Icon = ICONS[describeWeather(code, isDay).icon];
  return <Icon className={className} aria-hidden />;
}

const fmtMm = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${fmtNumber(v, 1)} mm/h`);

/* ================================================================= Cartão do Dashboard */
export function WeatherCard({ className }: { className?: string }) {
  const base = useBasePath();
  const demo = useDemo();
  const st = useAgent<WeatherStatus>("weather", { refetchInterval: 5 * 60_000 });
  const configured = st.data?.configured ?? false;
  const hourly = useAgent<WeatherHourly>(configured ? "weather/hourly?range=24h" : null, { refetchInterval: 15 * 60_000 });
  const d = st.data;
  const c = d?.current;
  const desc = describeWeather(c?.weather_code, c?.is_day ?? true);
  const source = demo ? "demonstracao" : "estimada";

  // Próximas horas (previsão): mostra as 6 seguintes à hora atual.
  const now = useNow(60_000);
  const nowHour = now === null ? null : Math.floor(now / 3600) * 3600;
  const next = nowHour === null ? [] : (hourly.data?.hours ?? []).filter((h) => h.hour_ts > nowHour).slice(0, 6);

  return (
    <Card className={className}>
      <CardHeader title="Clima agora" icon={<CloudSun />} subtitle={d?.location ? d.location.name : undefined} actions={configured && <SourceBadge source={source} />} />
      <CardBody>
        {st.error && <QueryError error={st.error} />}
        {!d && !st.error && <Skeleton className="h-40 w-full" />}
        {d && !configured && (
          <EmptyState
            icon={<MapPin />}
            title="Escolha a sua cidade"
            action={
              <Link href={`${hrefOf(base, "configuracoes")}#clima`} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                Configurar clima <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            }
          >
            Com a localização, o painel mostra o clima e marca nos gráficos quando a conexão oscilou com chuva.
          </EmptyState>
        )}
        {d && configured && !c && (
          <Callout tone="warn" title="Clima ainda indisponível">
            {d.last_error ? `A última busca falhou (${d.last_error}).` : "Aguardando a primeira busca."}
          </Callout>
        )}
        {d && configured && c && (
          <>
            <div className="flex items-center gap-4">
              <div className="ol-hud rounded-md border border-border bg-bg-elev p-3 text-accent">
                <WeatherGlyph code={c.weather_code} isDay={c.is_day ?? true} className="size-9 stroke-[1.4]" />
              </div>
              <div className="min-w-0">
                <p className="tabular text-3xl font-semibold leading-none text-fg">
                  {c.temperature_c === null ? "—" : fmtNumber(c.temperature_c, 0)}
                  <span className="ml-0.5 text-base font-normal text-fg-muted">°C</span>
                </p>
                <p className="mt-1 text-sm text-fg-muted">{desc.label}</p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border border-border bg-bg-elev/60 px-2 py-2">
                <dt className="flex items-center justify-center gap-1 text-[11px] text-fg-subtle">
                  <Droplets className="size-3.5" aria-hidden /> Chuva
                </dt>
                <dd className="tabular mt-0.5 text-sm text-fg">{fmtMm(c.precipitation_mm)}</dd>
              </div>
              <div className="rounded-md border border-border bg-bg-elev/60 px-2 py-2">
                <dt className="flex items-center justify-center gap-1 text-[11px] text-fg-subtle">
                  <Wind className="size-3.5" aria-hidden /> Vento
                </dt>
                <dd className="tabular mt-0.5 text-sm text-fg">{c.wind_kmh === null ? "—" : `${fmtNumber(c.wind_kmh, 0)} km/h`}</dd>
              </div>
              <div className="rounded-md border border-border bg-bg-elev/60 px-2 py-2">
                <dt className="flex items-center justify-center gap-1 text-[11px] text-fg-subtle">
                  <Cloud className="size-3.5" aria-hidden /> Nuvens
                </dt>
                <dd className="tabular mt-0.5 text-sm text-fg">{c.cloud_cover_pct === null ? "—" : `${fmtNumber(c.cloud_cover_pct, 0)}%`}</dd>
              </div>
            </dl>
            {next.length > 0 && (
              <div className="mt-4">
                <p className="ol-label mb-1.5">Próximas horas (previsão)</p>
                <ul className="grid grid-cols-6 gap-1">
                  {next.map((h) => (
                    <li key={h.hour_ts} className={cn("flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5", h.rain_level && h.rain_level !== "sem_chuva" ? "border-accent-2/40 bg-accent-soft" : "border-border")} title={`${fmtHM(h.hour_ts)} · ${describeWeather(h.weather_code).label}${h.precipitation_mm ? ` · ${fmtMm(h.precipitation_mm)}` : ""}`}>
                      <span className="tabular text-[10px] text-fg-subtle">{fmtHM(h.hour_ts).slice(0, 2)}h</span>
                      <WeatherGlyph code={h.weather_code} className="size-4 text-fg-muted" />
                      <span className="tabular text-[11px] text-fg">{h.temperature_c === null ? "—" : `${fmtNumber(h.temperature_c, 0)}°`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {c.rain_level && c.rain_level !== "sem_chuva" && (
              <p className="mt-3 text-xs text-fg-muted">
                <Badge tone="accent">{RAIN_META[c.rain_level].label}</Badge> Chuva pode coincidir com oscilação na conexão.
              </p>
            )}
            <p className="mt-3 text-[11px] leading-snug text-fg-subtle">
              Estimativa regional ({d.provider}), atualizada {fmtAgo(c.fetched_at)}
              {c.stale ? " · desatualizada" : ""}. Não é um sensor no local.
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* ================================================================= Localização (Configurações) */
export function WeatherLocationForm() {
  const demo = useDemo();
  const qc = useQueryClient();
  const st = useAgent<WeatherStatus>("weather");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const refresh = () => qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[1] === "string" && (q.queryKey[1] as string).startsWith("weather") });

  const search = useMutation({
    mutationFn: (q: string) => api<{ results: GeocodeResult[] }>(`weather/geocode?q=${encodeURIComponent(q)}`),
    onSuccess: (r) => setResults(r.results),
  });
  const choose = useMutation({
    mutationFn: (g: GeocodeResult) => api<WeatherStatus>("weather/location", { method: "PUT", body: JSON.stringify(g) }),
    onSuccess: () => {
      setResults(null);
      setQuery("");
      refresh();
    },
  });
  const clear = useMutation({ mutationFn: () => api<WeatherStatus>("weather/location", { method: "DELETE" }), onSuccess: refresh });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (query.trim().length >= 2) search.mutate(query.trim());
  }

  const d = st.data;
  const err = (search.error ?? choose.error ?? clear.error) as ApiError | null;

  return (
    <div className="space-y-4">
      {st.error && <QueryError error={st.error} />}
      {!d && !st.error ? (
        <Skeleton className="h-16 w-full" />
      ) : d ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-bg-elev/60 px-3 py-3">
          <div className="min-w-0">
            <p className="ol-label">Localização atual</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-fg">
              <MapPin className="size-4 shrink-0 text-accent" aria-hidden />
              {d.location ? d.location.name : <span className="text-fg-muted">nenhuma: o clima está desligado</span>}
            </p>
            {d.location && (
              <p className="mt-0.5 text-[11px] text-fg-subtle">
                {d.last_ok_at ? `Última busca ${fmtAgo(d.last_ok_at)}` : "Ainda sem busca concluída"}
                {d.last_error ? ` · último erro: ${d.last_error}` : ""}
              </p>
            )}
          </div>
          {d.location && (
            <Button size="sm" variant="ghost" onClick={() => clear.mutate()} loading={clear.isPending} disabled={demo}>
              <Trash2 /> Remover
            </Button>
          )}
        </div>
      ) : null}

      <form onSubmit={submit} className="flex gap-2" role="search">
        <label htmlFor="wq" className="sr-only">
          Buscar cidade
        </label>
        <Input id="wq" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Digite a sua cidade (ex.: Quixadá)" maxLength={80} disabled={demo} className="flex-1" />
        <Button type="submit" size="sm" loading={search.isPending} disabled={demo || query.trim().length < 2}>
          <Search /> Buscar
        </Button>
      </form>

      {results && results.length === 0 && <p className="text-sm text-fg-muted">Nenhuma cidade encontrada. Tente outro nome.</p>}
      {results && results.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {results.map((g) => (
            <li key={`${g.latitude},${g.longitude}`} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate text-sm text-fg">{g.name}</span>
              <Button size="sm" variant="primary" onClick={() => choose.mutate(g)} loading={choose.isPending && choose.variables === g}>
                Usar esta
              </Button>
            </li>
          ))}
        </ul>
      )}

      {err && <Callout tone="crit">{err.message}</Callout>}
      {demo && <Callout tone="demo">Na demonstração não é possível mudar a localização.</Callout>}
      <p className="text-[11px] leading-relaxed text-fg-subtle">
        Fonte: Open-Meteo, gratuita e sem chave. Só as coordenadas da cidade (arredondadas a ~1 km) saem do agente. A localização da antena nunca é consultada. O clima é uma estimativa regional, usada para mostrar coincidências com a conexão, não causas.
      </p>
    </div>
  );
}
