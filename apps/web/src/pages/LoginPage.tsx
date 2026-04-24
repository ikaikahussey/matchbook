import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";

type Mode = "volunteer" | "admin";

export function LoginPage() {
  const [mode, setMode] = useState<Mode>("volunteer");
  const [accessCode, setAccessCode] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { refresh } = useSession();
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "volunteer") {
        await api.login(accessCode.trim(), phone.trim());
      } else {
        await api.loginAdmin(adminCode.trim());
      }
      await refresh();
      navigate(mode === "admin" ? "/admin" : "/match", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="card w-full max-w-md">
        <h1 className="text-xl font-semibold mb-1">Voter Match</h1>
        <p className="text-sm text-slate-500 mb-5">
          Sign in with your campaign&apos;s access code.
        </p>

        <div className="flex gap-2 mb-5" role="tablist">
          <button
            type="button"
            className={mode === "volunteer" ? "btn-primary flex-1" : "btn-secondary flex-1"}
            onClick={() => setMode("volunteer")}
          >
            Volunteer
          </button>
          <button
            type="button"
            className={mode === "admin" ? "btn-primary flex-1" : "btn-secondary flex-1"}
            onClick={() => setMode("admin")}
          >
            Admin
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          {mode === "volunteer" ? (
            <>
              <label className="block">
                <span className="text-sm text-slate-700">Access code</span>
                <input
                  className="input mt-1 uppercase"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                  required
                  maxLength={6}
                  placeholder="ABC123"
                />
              </label>
              <label className="block">
                <span className="text-sm text-slate-700">Your phone number</span>
                <input
                  className="input mt-1"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  placeholder="+1 808 555 1212"
                />
              </label>
            </>
          ) : (
            <label className="block">
              <span className="text-sm text-slate-700">Admin code</span>
              <input
                className="input mt-1 uppercase"
                value={adminCode}
                onChange={(e) => setAdminCode(e.target.value.toUpperCase())}
                required
                maxLength={6}
              />
            </label>
          )}

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <button className="btn-primary w-full" type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
