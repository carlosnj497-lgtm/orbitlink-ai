import Image from "next/image";
import { cn } from "@/lib/cn";

/** Símbolo da ASTRYON (o "A" com órbita e satélite; arte fornecida pelo dono, fundo transparente). */
export function AstryonMark({ className }: { className?: string }) {
  return <Image src="/astryon-mark.webp" alt="" width={192} height={192} unoptimized preload className={cn("shrink-0 select-none", className)} />;
}

/** Símbolo pequeno + nome ASTRYON em texto. */
export function Wordmark({ className, size = "md" }: { className?: string; size?: "sm" | "md" }) {
  const sm = size === "sm";
  return (
    <span className={cn("inline-flex select-none items-center", sm ? "gap-2" : "gap-2.5", className)} role="img" aria-label="ASTRYON">
      <AstryonMark className={sm ? "size-8" : "size-10"} />
      <span aria-hidden className={cn("font-semibold uppercase leading-none text-fg", sm ? "text-[14px] tracking-[0.14em] max-[439px]:hidden" : "text-[18px] tracking-[0.22em]")}>
        Astryon
      </span>
    </span>
  );
}
