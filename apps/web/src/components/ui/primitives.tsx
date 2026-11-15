"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Dialog as RDialog, Switch as RSwitch, ToggleGroup as RToggleGroup, Tooltip as RTooltip } from "radix-ui";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/* ----------------------------------------------------------------- Card */
export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("ol-card", className)}
      {...p}
    />
  );
}

export function CardHeader({
  title,
  icon,
  actions,
  subtitle,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-4 pt-4", className)}>
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-fg">
          {icon && <span className="shrink-0 text-accent [&>svg]:size-4 [&>svg]:stroke-[1.75]">{icon}</span>}
          <span className="min-w-0">{title}</span>
        </h3>
        {subtitle && <p className="mt-0.5 text-xs text-fg-subtle">{subtitle}</p>}
      </div>
      {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4 pt-3", className)} {...p} />;
}

/* ----------------------------------------------------------------- Badge */
const badge = cva("inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase leading-4 tracking-[0.08em] whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "border-border-strong bg-surface-2 text-fg-muted",
      accent: "border-accent/30 bg-accent-soft text-accent",
      ok: "border-ok/30 bg-ok-soft text-ok",
      warn: "border-warn/30 bg-warn-soft text-warn",
      crit: "border-crit/30 bg-crit-soft text-crit",
      demo: "ol-demo-hatch border-dashed border-demo/60 bg-demo-soft text-demo",
      info: "border-border-strong bg-surface-2 text-fg-muted",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export type Tone = NonNullable<VariantProps<typeof badge>["tone"]>;

export function Badge({ tone, className, ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}

/* ----------------------------------------------------------------- Button */
const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 [&>svg]:size-4",
  {
    variants: {
      variant: {
        primary:
          "border border-accent-2/70 bg-accent-deep font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] hover:border-accent hover:bg-[#00609f] hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_6px_22px_-8px_rgb(0_140_255/0.75)]",
        secondary: "border border-border-strong bg-surface-2 text-fg hover:border-accent-2/50 hover:bg-surface-3",
        ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
        danger: "border border-crit/70 bg-crit/15 font-semibold text-crit hover:bg-crit hover:text-black",
      },
      size: { sm: "h-8 px-3", md: "h-9 px-4", icon: "size-9" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export function Button({
  variant,
  size,
  className,
  loading,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button> & { loading?: boolean }) {
  return (
    <button className={cn(button({ variant, size }), className)} disabled={loading || p.disabled} {...p}>
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- Skeleton */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-md", className)} />;
}

/* ----------------------------------------------------------------- Inputs */
export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-border-strong bg-bg-elev px-3 text-sm text-fg transition-[border-color,box-shadow] placeholder:text-fg-subtle focus:border-accent-2 focus:shadow-[0_0_0_3px_rgb(0_140_255/0.18)] focus:outline-none",
        className,
      )}
      {...p}
    />
  );
}

export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 rounded-md border border-border-strong bg-bg-elev px-2.5 text-sm text-fg transition-[border-color,box-shadow] focus:border-accent-2 focus:shadow-[0_0_0_3px_rgb(0_140_255/0.18)] focus:outline-none",
        className,
      )}
      {...p}
    />
  );
}

export function Label({ className, ...p }: HTMLAttributes<HTMLLabelElement> & { htmlFor?: string }) {
  return <label className={cn("text-xs font-medium text-fg-muted", className)} {...p} />;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-5 w-9 shrink-0 rounded-full border border-border-strong bg-surface-3 transition-colors data-[state=checked]:border-accent-2 data-[state=checked]:bg-accent-deep disabled:opacity-40"
    >
      <RSwitch.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-fg transition-transform data-[state=checked]:translate-x-[18px]" />
    </RSwitch.Root>
  );
}

/* ----------------------------------------------------------------- Tabs */
export function Tabs({
  value,
  onValueChange,
  items,
  className,
  label,
}: {
  value: string;
  onValueChange: (v: string) => void;
  items: { value: string; label: ReactNode }[];
  className?: string;
  label: string;
}) {
  // Controle segmentado (radiogroup): troca um filtro na mesma área, não alterna painéis — por isso não usa role=tab.
  return (
    <RToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v)}
      aria-label={label}
      className={cn("inline-flex rounded-md border border-border bg-bg-elev p-0.5", className)}
    >
      {items.map((it) => (
        <RToggleGroup.Item
          key={it.value}
          value={it.value}
          className="rounded-[4px] px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg data-[state=on]:bg-accent-soft data-[state=on]:text-accent data-[state=on]:shadow-[inset_0_0_0_1px_rgb(0_140_255/0.45)]"
        >
          {it.label}
        </RToggleGroup.Item>
      ))}
    </RToggleGroup.Root>
  );
}

/* ----------------------------------------------------------------- Tooltip */
export function Tip({ content, children, side }: { content: ReactNode; children: ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <RTooltip.Provider delayDuration={250}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content
            side={side}
            sideOffset={6}
            className="animate-pop-in z-50 max-w-xs rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-xs leading-relaxed text-fg shadow-[0_12px_32px_-12px_rgb(0_0_0/0.9)]"
          >
            {content}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}

/* ----------------------------------------------------------------- Dialog */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="animate-fade-in fixed inset-0 z-40 bg-black/75" />
        <RDialog.Content className="ol-hud animate-pop-in fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border-strong bg-surface-2 p-5 shadow-2xl focus:outline-none">
          <RDialog.Title className="font-display text-base font-semibold">{title}</RDialog.Title>
          {description && <RDialog.Description className="mt-1 text-sm text-fg-muted">{description}</RDialog.Description>}
          <div className="mt-4">{children}</div>
          {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/* ----------------------------------------------------------------- Feedback */
export function Callout({
  tone = "neutral",
  icon,
  title,
  children,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-border-strong bg-surface-2/60",
    accent: "border-accent/30 bg-accent-soft",
    ok: "border-ok/30 bg-ok-soft",
    warn: "border-warn/30 bg-warn-soft",
    crit: "border-crit/30 bg-crit-soft",
    demo: "ol-demo-hatch border-dashed border-demo/50 bg-demo-soft",
    info: "border-border-strong bg-surface-2/60",
  };
  const iconTone: Record<string, string> = { ok: "text-ok", warn: "text-warn", crit: "text-crit", accent: "text-accent", info: "text-accent", neutral: "text-fg-subtle", demo: "text-demo" };
  return (
    // Erro crítico é anunciado na hora pelo leitor de tela; os demais avisos, sem interromper.
    <div role={tone === "crit" ? "alert" : "status"} className={cn("flex gap-3 rounded-md border px-3.5 py-3 text-sm", tones[tone], className)}>
      {icon && <span className={cn("mt-0.5 shrink-0 [&>svg]:size-4", iconTone[tone])}>{icon}</span>}
      <div className="min-w-0">
        {title && <p className="font-medium text-fg">{title}</p>}
        {children && <div className="mt-0.5 text-fg-muted">{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      {icon && <div className="ol-hud mb-1 rounded-md border border-border bg-bg-elev p-3 text-accent [&>svg]:size-5 [&>svg]:stroke-[1.5]">{icon}</div>}
      <p className="text-sm font-medium text-fg">{title}</p>
      {children && <div className="max-w-md text-sm text-fg-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
