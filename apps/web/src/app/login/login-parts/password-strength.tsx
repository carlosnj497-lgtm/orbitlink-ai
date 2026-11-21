import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

function score(password: string): { value: number; label: string; tone: "crit" | "warn" | "ok" } {
  if (!password) return { value: 0, label: "Muito fraca", tone: "crit" };
  let points = 0;
  if (password.length >= 10) points += 1;
  if (password.length >= 14) points += 1;
  if (/[A-Z]/.test(password)) points += 1;
  if (/[a-z]/.test(password)) points += 1;
  if (/[0-9]/.test(password)) points += 1;
  if (/[^A-Za-z0-9]/.test(password)) points += 1;

  if (points <= 2) return { value: Math.max(1, points), label: "Fraca", tone: "crit" };
  if (points <= 4) return { value: points, label: "Média", tone: "warn" };
  return { value: Math.min(6, points), label: "Forte", tone: "ok" };
}

const TONE_TEXT = { crit: "text-crit", warn: "text-warn", ok: "text-ok" } as const;
const TONE_FILL = { crit: "bg-crit", warn: "bg-warn", ok: "bg-ok" } as const;

/** Medidor de força em segmentos, como leitura de instrumento; requisitos marcados abaixo. */
export function PasswordStrength({ password }: { password: string }) {
  const { value, label, tone } = score(password);
  const req = [
    { ok: password.length >= 10, text: "10 caracteres" },
    { ok: /[A-Z]/.test(password) && /[a-z]/.test(password), text: "maiúscula e minúscula" },
    { ok: /[0-9]/.test(password), text: "número" },
    { ok: /[^A-Za-z0-9]/.test(password), text: "símbolo" },
  ];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className={cn("h-1.5 flex-1 rounded-[2px] transition-colors duration-200", i < value ? TONE_FILL[tone] : "bg-surface-2")} />
          ))}
        </div>
        {/* Largura fixa: o medidor não balança quando o rótulo muda. */}
        <span className={cn("w-14 text-right text-[11px] font-medium", password ? TONE_TEXT[tone] : "text-fg-subtle")}>{password ? label : "Força"}</span>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-fg-subtle">
        {req.map((r) => (
          <li key={r.text} className={cn("flex items-center gap-1 transition-colors", r.ok && "text-fg-muted")}>
            {r.ok ? (
              <Check className="size-3 text-ok" aria-hidden />
            ) : (
              <span aria-hidden className="grid size-3 place-items-center">
                <span className="size-1 rounded-full bg-fg-subtle/50" />
              </span>
            )}
            {r.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
