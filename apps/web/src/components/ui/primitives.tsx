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
      className={cn(
        "rounded-card border border-border bg-surface/80 shadow-[0_1px_0_0_rgb(255_255_255/0.03)_inset,0_8px_24px_-12px_rgb(0_0_0/0.6)] backdrop-blur-sm",
        className,
      )}
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
        <h3 className="flex items-center gap-2 text-[13px] font-medium tracking-wide text-fg-muted">
          {icon && <span className="text-fg-subtle [&>svg]:size-4">{icon}</span>}
          {title}
        </h3>
        {subtitle && <p className="mt-0.5 text-xs text-fg-subtle">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4 pt-3", className)} {...p} />;
}

/* ----------------------------------------------------------------- Badge */
const badge = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "border-border-strong bg-surface-2 text-fg-muted",
      accent: "border-accent/30 bg-accent-soft text-accent",
      ok: "border-ok/30 bg-ok-soft text-ok",
      warn: "border-warn/30 bg-warn-soft text-warn",
      crit: "border-crit/30 bg-crit-soft text-crit",
      demo: "border-demo/40 bg-demo-soft text-demo",
      info: "border-info/30 bg-info/10 text-info",
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
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 [&>svg]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-accent text-[#04121a] hover:bg-accent-strong",
        secondary: "border border-border-strong bg-surface-2 text-fg hover:bg-surface-3",
        ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
        danger: "bg-crit text-[#1a0505] hover:bg-crit/85",
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
        "h-9 w-full rounded-lg border border-border-strong bg-bg-elev px-3 text-sm text-fg placeholder:text-fg-subtle focus:border-accent/60 focus:outline-none",
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
        "h-9 rounded-lg border border-border-strong bg-bg-elev px-2.5 text-sm text-fg focus:border-accent/60 focus:outline-none",
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
      className="relative h-5 w-9 shrink-0 rounded-full border border-border-strong bg-surface-3 transition-colors data-[state=checked]:border-accent/50 data-[state=checked]:bg-accent/40 disabled:opacity-40"
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
      className={cn("inline-flex rounded-lg border border-border bg-bg-elev p-0.5", className)}
    >
      {items.map((it) => (
        <RToggleGroup.Item
          key={it.value}
          value={it.value}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg data-[state=on]:bg-surface-3 data-[state=on]:text-fg"
        >
          {it.label}
        </RToggleGroup.Item>
      ))}
    </RToggleGroup.Root>
  );
}

/* ----------------------------------------------------------------- Tooltip */
export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={250}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content
            sideOffset={6}
            className="z-50 max-w-xs rounded-lg border border-border-strong bg-surface-2 px-3 py-2 text-xs leading-relaxed text-fg shadow-xl"
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
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <RDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-strong bg-surface p-5 shadow-2xl focus:outline-none">
          <RDialog.Title className="text-base font-semibold">{title}</RDialog.Title>
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
    demo: "border-demo/40 bg-demo-soft",
    info: "border-info/30 bg-info/10",
  };
  return (
    <div role="status" className={cn("flex gap-3 rounded-lg border px-3.5 py-3 text-sm", tones[tone], className)}>
      {icon && <span className="mt-0.5 shrink-0 [&>svg]:size-4">{icon}</span>}
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
      {icon && <div className="mb-1 rounded-full border border-border bg-surface-2 p-3 text-fg-subtle [&>svg]:size-5">{icon}</div>}
      <p className="text-sm font-medium text-fg">{title}</p>
      {children && <div className="max-w-md text-sm text-fg-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
