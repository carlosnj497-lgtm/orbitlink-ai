import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { DemoProvider } from "@/lib/demo-context";
import { ViewRouter } from "@/views/registry";
import { SLUGS, TITLES } from "@/views/slugs";

export function generateStaticParams() {
  return SLUGS.map((s) => ({ slug: s ? [s] : [] }));
}

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug?.join("/") ?? "";
  return { title: `Demonstração · ${TITLES[slug] ?? ""}` };
}

/** Rota de demonstração: dados fictícios gerados no navegador, com faixa de aviso permanente. */
export default async function DemoPage({ params }: Props) {
  const slug = (await params).slug?.join("/") ?? "";
  if (!(SLUGS as readonly string[]).includes(slug)) notFound();
  return (
    <DemoProvider>
      <AppShell>
        <ViewRouter slug={slug} />
      </AppShell>
    </DemoProvider>
  );
}
