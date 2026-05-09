import type { CampaignRelationships } from "@voter-match/shared";
import { CODENAME_ADJECTIVES, CODENAME_NOUNS, generateCodename } from "@voter-match/shared";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";

export function RelationshipsPage() {
  const { session, refresh } = useSession();
  const [data, setData] = useState<CampaignRelationships[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftCodename, setDraftCodename] = useState("");
  const [savingCodename, setSavingCodename] = useState(false);
  const [codenameError, setCodenameError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.myRelationships();
      setData(res.campaigns);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const currentCampaign = useMemo(
    () => data.find((c) => c.campaignId === session?.campaignId),
    [data, session?.campaignId],
  );

  function pickRandom() {
    setDraftCodename(generateCodename());
    setCodenameError(null);
  }

  async function saveCodename() {
    setSavingCodename(true);
    setCodenameError(null);
    try {
      await api.setCodename(draftCodename.trim().toLowerCase());
      await refresh();
      await load();
      setEditing(false);
    } catch (err) {
      setCodenameError(err instanceof Error ? err.message : "could not save");
    } finally {
      setSavingCodename(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">Your relationships</h2>
            <p className="text-sm text-slate-500">
              Confirmed matches across every campaign you've joined.
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase text-slate-500">Codename in {session?.campaignName}</div>
            {editing ? (
              <div className="mt-1 flex items-center gap-2">
                <select
                  className="input"
                  value={draftCodename.split("-")[0] ?? ""}
                  onChange={(e) =>
                    setDraftCodename(`${e.target.value}-${draftCodename.split("-")[1] ?? CODENAME_NOUNS[0]}`)
                  }
                >
                  {CODENAME_ADJECTIVES.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
                <span className="text-slate-400">-</span>
                <select
                  className="input"
                  value={draftCodename.split("-")[1] ?? ""}
                  onChange={(e) =>
                    setDraftCodename(`${draftCodename.split("-")[0] ?? CODENAME_ADJECTIVES[0]}-${e.target.value}`)
                  }
                >
                  {CODENAME_NOUNS.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-secondary" onClick={pickRandom}>
                  Random
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={saveCodename}
                  disabled={savingCodename}
                >
                  {savingCodename ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setEditing(false);
                    setCodenameError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-2 justify-end">
                <span className="font-mono text-brand-700">{session?.codename ?? "—"}</span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setDraftCodename(session?.codename ?? generateCodename());
                    setEditing(true);
                  }}
                >
                  Change
                </button>
              </div>
            )}
            {codenameError && <p className="text-xs text-rose-600 mt-1">{codenameError}</p>}
          </div>
        </div>
      </section>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : data.length === 0 ? (
        <section className="card">
          <p className="text-sm text-slate-500">
            No confirmed relationships yet. Head to Match to add some.
          </p>
        </section>
      ) : (
        data.map((c) => (
          <section key={c.campaignId} className="card">
            <header className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold">{c.campaignName}</h3>
                <p className="text-xs text-slate-500">
                  Your codename here:{" "}
                  <span className="font-mono">{c.codename ?? "—"}</span> ·{" "}
                  {c.relationships.length} relationship{c.relationships.length === 1 ? "" : "s"}
                </p>
              </div>
              {c.campaignId === currentCampaign?.campaignId && (
                <span className="chip bg-brand-50 text-brand-700">current</span>
              )}
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">City / ZIP</th>
                    <th className="py-2 pr-3">Precinct</th>
                    <th className="py-2 pr-3">Tag</th>
                    <th className="py-2 pr-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {c.relationships.map((r) => (
                    <tr key={r.matchId}>
                      <td className="py-2 pr-3 font-medium">
                        {[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {[r.city, r.zip].filter(Boolean).join(" ")}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{r.district ?? "—"}</td>
                      <td className="py-2 pr-3">
                        {r.relationshipTag ? (
                          <span className="chip bg-brand-50 text-brand-700">
                            {r.relationshipTag}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{r.notes ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
