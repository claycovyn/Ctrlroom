import { redirect } from "next/navigation";

/** The Feed moved to Home (/app). Old links keep working, tab included. */
export default async function Feed({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  redirect(tab === "everyone" ? "/app?tab=everyone" : "/app");
}
