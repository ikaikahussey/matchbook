import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";

export function TermsPage() {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { refresh, clear } = useSession();
  const navigate = useNavigate();

  async function accept() {
    setSubmitting(true);
    try {
      await api.acceptTerms();
      await refresh();
      navigate("/match", { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  async function decline() {
    await api.logout();
    clear();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="card max-w-2xl">
        <h1 className="text-xl font-semibold mb-3">Terms of use</h1>
        <div className="prose prose-slate max-w-none text-sm space-y-3 mb-4">
          <p>
            Voter file data is provided to this campaign under the terms of your state&apos;s
            voter registration law. By continuing, you agree to:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Use the data only for activities permitted by your state&apos;s voter file rules.</li>
            <li>Not share, sell, or republish voter records outside this campaign.</li>
            <li>
              Not copy the voter file or screenshots of match results to personal devices outside
              this app.
            </li>
            <li>Stop using the app and log out if you leave the campaign.</li>
          </ul>
          <p>
            Your phone contacts are hashed in your browser before leaving your device. Raw contact
            data never reaches our servers. Match actions (confirmations, rejections, exports) are
            logged for compliance audits.
          </p>
        </div>

        <label className="flex items-start gap-2 mb-4 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>I&apos;ve read and agree to the terms above.</span>
        </label>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={accept}
            disabled={!agreed || submitting}
            className="btn-primary"
          >
            {submitting ? "Saving…" : "I agree"}
          </button>
          <button type="button" onClick={decline} className="btn-secondary">
            Decline and log out
          </button>
        </div>
      </div>
    </div>
  );
}
