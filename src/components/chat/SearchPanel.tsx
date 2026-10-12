"use client";

import Link from "next/link";
import { useState } from "react";
import { sinceLabel } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useCommunity } from "./CommunityContext";
import { Panel } from "./Panel";
import { RichText } from "./RichText";

interface Hit {
  id: string;
  room_id: string;
  parent_id: string | null;
  body: string;
  author_id: string;
  created_at: string;
}

export function SearchPanel({ onClose }: { onClose: () => void }) {
  const { me, community, rooms, profiles, ensureProfiles } = useCommunity();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    const { data } = await supabaseBrowser().rpc("search_messages", { p_community: community.id, p_query: q.trim(), p_limit: 50 });
    const list = (data ?? []) as Hit[];
    ensureProfiles([...new Set(list.map((h) => h.author_id))]);
    setHits(list);
    setBusy(false);
  };

  return (
    <Panel title={`Search ${community.name}`} onClose={onClose}>
      <form onSubmit={run} className="border-b border-line p-4">
        <input className="input" placeholder="Search every message, ever" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <p className="mt-2 text-xs text-muted">Use quotes for exact phrases, and a minus sign to leave words out.</p>
      </form>
      {busy && <p className="px-4 py-3 text-sm text-muted">Searching…</p>}
      {hits && !busy && hits.length === 0 && <p className="px-4 py-3 text-sm text-muted">No messages found.</p>}
      <ul className="divide-y divide-line">
        {hits?.map((h) => {
          const room = rooms.find((r) => r.id === h.room_id);
          const thread = h.parent_id ?? h.id;
          return (
            <li key={h.id}>
              <Link href={`/c/${community.slug}/${room?.slug ?? ""}?m=${thread}`} className="block px-4 py-3 hover:bg-raised">
                <p className="mb-1 text-xs text-muted">
                  #{room?.name} · {profiles[h.author_id]?.display_name ?? "…"} · {sinceLabel(h.created_at)}
                  {h.parent_id && " · in a thread"}
                </p>
                <p className="line-clamp-3 text-sm">
                  <RichText body={h.body} myUsername={me.username} />
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
