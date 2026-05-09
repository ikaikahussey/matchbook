import type { CampaignMembership } from "@voter-match/shared";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";

export function Shell({ children }: { children: ReactNode }) {
  const { session, refresh, clear } = useSession();
  const navigate = useNavigate();
  const [memberships, setMemberships] = useState<CampaignMembership[]>([]);

  useEffect(() => {
    if (!session || session.role !== "volunteer") return;
    api
      .myCampaigns()
      .then((r) => setMemberships(r.campaigns))
      .catch(() => setMemberships([]));
  }, [session?.volunteerId, session?.campaignId, session?.role]);

  if (!session) return null;

  const nav =
    session.role === "admin"
      ? [{ to: "/admin", label: "Dashboard" }]
      : [
          { to: "/match", label: "Match" },
          { to: "/my-list", label: "My List" },
          { to: "/relationships", label: "Relationships" },
        ];

  async function logout() {
    try {
      await api.logout();
    } finally {
      clear();
      navigate("/login", { replace: true });
    }
  }

  async function onSwitch(e: React.ChangeEvent<HTMLSelectElement>) {
    const target = e.target.value;
    if (!target || target === session?.campaignId) return;
    try {
      await api.switchCampaign(target);
      await refresh();
      navigate("/match", { replace: true });
    } catch {
      /* ignore; selector resets via refresh */
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl flex items-center justify-between p-4">
          <Link to="/" className="text-lg font-semibold text-brand-600">
            Voter Match
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  isActive ? "text-brand-600 font-medium" : "text-slate-600 hover:text-slate-900"
                }
              >
                {n.label}
              </NavLink>
            ))}
            <span className="text-slate-400">|</span>
            {session.role === "volunteer" && memberships.length > 1 ? (
              <select
                className="input py-1 text-sm"
                value={session.campaignId}
                onChange={onSwitch}
                title="Switch campaign"
              >
                {memberships.map((m) => (
                  <option key={m.campaignId} value={m.campaignId}>
                    {m.campaignName}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-slate-500 truncate max-w-[16ch]" title={session.campaignName}>
                {session.campaignName}
              </span>
            )}
            {session.role === "volunteer" && session.codename && (
              <span
                className="chip bg-brand-50 text-brand-700 font-mono"
                title="Your codename in this campaign"
              >
                {session.codename}
              </span>
            )}
            <button type="button" onClick={logout} className="btn-secondary">
              Log out
            </button>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-5xl p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
