"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/chat/Avatar";
import { useCommunity } from "@/components/chat/CommunityContext";
import { levelProgress } from "@/lib/levels";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Standing } from "@/lib/types";
import { Page } from "./PageHeader";

type Period = "7d" | "30d" | "all";
interface Row {
  user_id: string;
  points: number;
  total_points: number;
  level: number;
}

const PERIODS: { id: Period; label: string }[] = [
  { id: "7d", label: "This week" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
];

export function LeaderboardView({
  standing,
  initialRows,
  unlocks,
}: {
  standing: Standing | null;
  initialRows: Row[];
  unlocks: { title: string; unlock_level: number }[];
}) {
  const { me, community, profiles, ensureProfiles, addPoints } = useCommunity();
  const [period, setPeriod] = useState<Period>("7d");
  const [rows, setRows] = useState(initialRows);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    ensureProfiles(rows.map((r) => r.user_id));
    addPoints(Object.fromEntries(rows.map((r) => [r.user_id, r.total_points])));
  }, [rows, ensureProfiles, addPoints]);

  const pick = async (p: Period) => {
    setPeriod(p);
    setLoading(true);
    const { data } = await supabaseBrowser().rpc("leaderboard", { p_community: community.id, p_period: p, p_limit: 50 });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  const total = standing?.levels.reduce((n, l) => n + l.members, 0) || 1;
  const prog = standing ? levelProgress(standing.points) : null;
  const myRank = rows.findIndex((r) => r.user_id === me.id);

  return (
    <Page wide title="Leaderboard">
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {standing && prog && (
            <section className="card flex flex-wrap items-center gap-5 p-5">
              <Avatar profile={me} size={64} level={prog.level} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted">{me.display_name}</p>
                <p className="text-2xl font-semibold">Level {prog.level}</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-raised">
                  <div className="h-full rounded-full bg-signal transition-all" style={{ width: `${Math.round(prog.progress * 100)}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-muted">
                  {standing.points} points
                  {prog.next ? ` · ${prog.toGo} to Level ${prog.level + 1}` : " · top level"}
                  {` · ${standing.week_points} this week`}
                </p>
              </div>
            </section>
          )}

          <section className="card overflow-hidden">
            <div className="flex items-center gap-1 border-b border-line p-2" role="tablist">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={period === p.id}
                  onClick={() => pick(p.id)}
                  className={`rounded-md px-3 py-1.5 text-sm ${period === p.id ? "bg-raised font-medium" : "text-muted hover:text-fg"}`}
                >
                  {p.label}
                </button>
              ))}
              {myRank >= 0 && <span className="ml-auto pr-2 text-xs text-muted">You’re #{myRank + 1}</span>}
            </div>
            {loading ? (
              <p className="p-6 text-sm text-muted">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">
                {period === "7d" ? "No points yet this week. Everyone starts fresh each week, so this one’s up for grabs." : "No points yet."}
              </p>
            ) : (
              <ol className="divide-y divide-line">
                {rows.map((r, i) => (
                  <li key={r.user_id} className={`flex items-center gap-3 px-4 py-2.5 ${r.user_id === me.id ? "bg-signal/5" : ""}`}>
                    <span className={`w-6 text-center text-sm font-semibold ${i < 3 ? "" : "text-muted"}`}>{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>
                    <Avatar profile={profiles[r.user_id]} size={32} level={r.level} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{profiles[r.user_id]?.display_name ?? "…"}</span>
                    <span className="text-sm tabular-nums">
                      {period === "all" ? "" : "+"}
                      {r.points}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          {standing && (
            <section className="card p-5">
              <h2 className="mb-3 font-medium">Levels</h2>
              <ul className="space-y-2 text-sm">
                {standing.levels.map((l) => {
                  const pct = Math.round((l.members / total) * 100);
                  const opens = unlocks.filter((u) => u.unlock_level === l.level);
                  return (
                    <li key={l.level}>
                      <div className="flex items-center gap-2">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${l.level <= (prog?.level ?? 1) ? "bg-signal text-signal-fg" : "bg-raised text-muted"}`}>
                          {l.level}
                        </span>
                        <span className="flex-1">Level {l.level}</span>
                        <span className="text-xs text-muted">{pct}% of members</span>
                      </div>
                      {opens.length > 0 && <p className="ml-8 text-xs text-muted">Unlocks: {opens.map((o) => o.title).join(", ")}</p>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <section className="card p-5 text-sm">
            <h2 className="mb-2 font-medium">How points work</h2>
            <ul className="space-y-1.5 text-muted">
              <li>
                <span className="text-fg">+1</span> when someone likes your post or comment. Each person can give you <span className="text-fg">one point a day</span>, so trading likes doesn’t pay.
              </li>
              <li>
                <span className="text-fg">+1</span> for each lesson you finish in the Classroom.
              </li>
              <li>
                <span className="text-fg">+5</span> when your comment is marked as the answer to a question.
              </li>
              <li>The weekly board resets every week, so newcomers can top it too.</li>
            </ul>
          </section>
        </aside>
      </div>
    </Page>
  );
}
