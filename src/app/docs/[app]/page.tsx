import { notFound, redirect } from "next/navigation";
import { loadDocs } from "@/lib/docs";

export function generateStaticParams() {
  return loadDocs().map((a) => ({ app: a.slug }));
}

export default async function DocsApp({ params }: { params: Promise<{ app: string }> }) {
  const { app } = await params;
  const first = loadDocs().find((a) => a.slug === app)?.pages[0];
  if (!first) notFound();
  redirect(first.url);
}
