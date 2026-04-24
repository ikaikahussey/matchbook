import type { AdminStats } from "@voter-match/shared";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function loadStats() {
    try {
      setStats(await api.adminStats());
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load stats");
    }
  }

  useEffect(() => {
    loadStats();
  }, []);

  async function onUpload(file: File) {
    setError(null);
    setUploadResult(null);
    setUploading(true);
    try {
      const res = await api.uploadVoterFile(file);
      setUploadResult(
        `Ingested ${res.inserted.toLocaleString()} rows across ${res.districts.length} districts (version ${res.version}).`,
      );
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <section className="card">
        <h2 className="font-semibold mb-1">Voter file upload</h2>
        <p className="text-sm text-slate-500 mb-3">
          Upload a CSV with columns: voter_id, first_name, last_name, address, city, zip, phone,
          party, district, last_voted. This replaces the current voter set for this campaign.
        </p>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
          }}
          disabled={uploading}
          className="text-sm"
        />
        {uploading && <p className="text-sm text-slate-500 mt-2">Uploading and hashing…</p>}
        {uploadResult && <p className="text-sm text-emerald-700 mt-2">{uploadResult}</p>}
        {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
      </section>

      {stats && (
        <section className="card">
          <h2 className="font-semibold mb-3">Stats</h2>
          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            <Stat label="Volunteers enrolled" value={stats.volunteersEnrolled} />
            <Stat
              label="Unique voters with a known relationship"
              value={stats.uniqueVotersWithRelationship}
            />
          </div>

          <h3 className="text-sm font-medium text-slate-700 mb-2">Coverage by precinct</h3>
          {stats.coverageByPrecinct.length === 0 ? (
            <p className="text-sm text-slate-500">No districts yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1 pr-3">District</th>
                  <th className="py-1 pr-3">Total voters</th>
                  <th className="py-1 pr-3">Covered</th>
                  <th className="py-1 pr-3">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.coverageByPrecinct.map((r) => (
                  <tr key={r.district}>
                    <td className="py-1 pr-3">{r.district}</td>
                    <td className="py-1 pr-3">{r.total.toLocaleString()}</td>
                    <td className="py-1 pr-3">{r.covered.toLocaleString()}</td>
                    <td className="py-1 pr-3">{r.percent.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-slate-400 mt-3">
            No PII from volunteer contacts is shown here — only aggregate counts.
          </p>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}
