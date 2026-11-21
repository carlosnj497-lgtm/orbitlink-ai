import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

interface CheckboxProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  disabled?: boolean;
}

/** Checkbox estilizado alinhado ao tema escuro do painel. */
export function Checkbox({ id, checked, onChange, label, disabled }: CheckboxProps) {
  return (
    <label htmlFor={id} className={cn("group flex items-start gap-2.5 text-xs text-fg-muted", disabled && "opacity-50", !disabled && "cursor-pointer")}>
      <span
        className={cn(
          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-[3px] border transition-colors",
          checked ? "border-accent-2 bg-accent-deep" : "border-border-strong bg-bg-elev group-hover:border-accent-2/60",
        )}
        aria-hidden
      >
        {checked && <Check className="size-3 text-fg" strokeWidth={2.5} />}
      </span>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} className="sr-only" />
      <span className="leading-snug">{label}</span>
    </label>
  );
}
