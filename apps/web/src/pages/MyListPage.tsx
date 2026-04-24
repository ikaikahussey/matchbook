import type { RelationshipTag } from "@voter-match/shared";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

interface Entry {
  matchId: string;
  confirmed: boolean;
  rejected: boolean;
  relationshipTag: RelationshipTag | null;
  notes: string | null;
  district: string | null;
  voter: {
    voter_id: string;
    first_name: string | null;
    last_name: string | null;
    address: string | null;
    city: string | null;
    zip: string | null;
    party: string | null;
    last_voted: string | null;
  };
}

export function MyListPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [precinct, setPrecinct] = useState("");
  const [tag, setTag] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await api.myList({
        precinct: precinct || undefined,
        tag: tag || undefined,
      });
      setEntries(res.entries as unknown as Entry[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [precinct, tag]);

  const precincts = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) if (e.district) s.add(e.district);
    return [...s].sort();
  }, [entries]);

  const exportHref = (suffix: "csv" | "pdf") => {
    const q = new URLSearchParams();
    if (precinct) q.set("precinct", precinct);
    if (tag) q.set("tag", tag);
    const qs = q.toString() ? `?${q}` : "";
    return `/api/my-list/export.${suffix}${qs}`;
  };

  return (
    <div className="space-y-4">
      <section className="card">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs text-slate-600">Precinct</span>
            <select
              className="input mt-1"
              value={precinct}
              onChange={(e) => setPrecinct(e.target.value)}
            >
              <option value="">All</option>
              {precincts.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-600">Relationship</span>
            <select className="input mt-1" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">All</option>
              {["family", "friend", "neighbor", "coworker", "acquaintance"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex gap-2">
            <a className="btn-secondary" href={exportHref("csv")}>
              Export CSV
            </a>
            <a className="btn-secondary" href={exportHref("pdf")}>
              Walk sheet PDF
            </a>
          </div>
        </div>
      </section>

      <section className="card">
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-500">
            No confirmed matches yet. Head back to Match to add some.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Address</th>
                  <th className="py-2 pr-3">Precinct</th>
                  <th className="py-2 pr-3">Party</th>
                  <th className="py-2 pr-3">Tag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e) => (
                  <tr key={e.matchId}>
                    <td className="py-2 pr-3 font-medium">
                      {[e.voter.first_name, e.voter.last_name].filter(Boolean).join(" ")}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">
                      {[e.voter.address, e.voter.city, e.voter.zip].filter(Boolean).join(", ")}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{e.district ?? "—"}</td>
                    <td className="py-2 pr-3 text-slate-600">{e.voter.party ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {e.relationshipTag ? (
                        <span className="chip bg-brand-50 text-brand-700">{e.relationshipTag}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
