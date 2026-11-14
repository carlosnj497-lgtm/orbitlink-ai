import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { ViewRouter } from "@/views/registry";
import { SLUGS, TITLES } from "@/views/slugs";

export function generateStaticParams() {
  return SLUGS.map((s) => ({ slug: s ? [s] : [] }));
}

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug?.join("/") ?? "";
  return { title: TITLES[slug] ?? "ASTRYON" };
}

export default async function Page({ params }: Props) {
  const slug = (await params).slug?.join("/") ?? "";
  if (!(SLUGS as readonly string[]).includes(slug)) notFound();
  return (
    <AppShell>
      <ViewRouter slug={slug} />
    </AppShell>
  );
}
