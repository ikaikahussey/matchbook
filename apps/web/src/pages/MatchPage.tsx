import {
  hashContacts,
  MAX_HASHES_PER_REQUEST,
  parseContactsCsv,
  parseVCard,
  type ContactCandidate,
  type HashBundle,
  type MatchedVoter,
  type RelationshipTag,
} from "@voter-match/shared";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";

interface LocalMatch extends MatchedVoter {
  contactLabel: string;
  state: "pending" | "confirmed" | "rejected";
  relationshipTag?: RelationshipTag;
  notes?: string;
}

const RELATIONSHIP_TAGS: RelationshipTag[] = [
  "family",
  "friend",
  "neighbor",
  "coworker",
  "acquaintance",
];

export function MatchPage() {
  const { session } = useSession();
  const [parsing, setParsing] = useState(false);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactCount, setContactCount] = useState(0);
  const [hashCount, setHashCount] = useState(0);
  const [matches, setMatches] = useState<LocalMatch[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setError(null);
    setParsing(true);
    setMatches([]);
    try {
      const text = await file.text();
      const contacts: ContactCandidate[] = file.name.toLowerCase().endsWith(".csv")
        ? parseContactsCsv(text)
        : parseVCard(text);
      setContactCount(contacts.length);

      if (!session) throw new Error("session expired");
      const bundle: HashBundle = await hashContacts(session.salt, contacts);
      const total = bundle.phone.length + bundle.nameZip.length + bundle.nameAddr.length;
      setHashCount(total);
      if (total === 0) {
        setError("No usable phone numbers or name+address pairs found in this file.");
        return;
      }
      if (total > MAX_HASHES_PER_REQUEST) {
        setError(
          `This file produced ${total} hashes, over the ${MAX_HASHES_PER_REQUEST} request limit. Split the file and try again.`,
        );
        return;
      }

      setMatching(true);
      const resp = await api.match({
        phone: bundle.phone,
        nameZip: bundle.nameZip,
        nameAddr: bundle.nameAddr,
      });

      const contactsByLocalId = new Map(contacts.map((c) => [c.localId, c]));
      const local: LocalMatch[] = resp.matches.map((m) => {
        const origin = bundle.byHash[m.matchedHash];
        const label = origin ? contactsByLocalId.get(origin.localId)?.displayName ?? "" : "";
        return { ...m, contactLabel: label, state: "pending" };
      });
      setMatches(local);
    } catch (err) {
      setError(err instanceof Error ? err.message : "something went wrong");
    } finally {
      setParsing(false);
      setMatching(false);
    }
  }

  async function confirm(idx: number, tag: RelationshipTag, notes: string) {
    const m = matches[idx];
    await api.confirmMatch(m.matchId, { relationshipTag: tag, notes });
    setMatches((xs) =>
      xs.map((x, i) =>
        i === idx ? { ...x, state: "confirmed", relationshipTag: tag, notes } : x,
      ),
    );
  }

  async function reject(idx: number) {
    const m = matches[idx];
    await api.rejectMatch(m.matchId);
    setMatches((xs) => xs.map((x, i) => (i === idx ? { ...x, state: "rejected" } : x)));
  }

  const byTier = {
    high: matches.filter((m) => m.confidence === "high"),
    medium: matches.filter((m) => m.confidence === "medium"),
    low: matches.filter((m) => m.confidence === "low"),
  };

  return (
    <div className="space-y-5">
      <section className="card">
        <h2 className="font-semibold mb-1">Upload contacts</h2>
        <p className="text-sm text-slate-500 mb-3">
          Export your phone contacts as a vCard (.vcf) or CSV. Hashing happens in your browser —
          raw contact data never leaves this device.
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".vcf,.csv,text/vcard,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
            className="text-sm"
          />
          {parsing && <span className="text-sm text-slate-500">Hashing…</span>}
          {matching && <span className="text-sm text-slate-500">Searching voter file…</span>}
        </div>
        {(contactCount > 0 || hashCount > 0) && (
          <p className="text-xs text-slate-500 mt-2">
            Parsed {contactCount} contacts → {hashCount} hashes sent.
          </p>
        )}
        {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}
      </section>

      {matches.length > 0 && (
        <>
          <TierSection title="High confidence (phone / name + address)" items={byTier.high} confirm={confirm} reject={reject} offset={0} matches={matches} />
          <TierSection
            title="Medium confidence (name + ZIP)"
            items={byTier.medium}
            confirm={confirm}
            reject={reject}
            offset={byTier.high.length}
            matches={matches}
          />
          {byTier.low.length > 0 && (
            <TierSection
              title="Low confidence"
              items={byTier.low}
              confirm={confirm}
              reject={reject}
              offset={byTier.high.length + byTier.medium.length}
              matches={matches}
            />
          )}
          <p className="text-sm text-slate-500">
            Confirmed matches appear on your <Link to="/my-list" className="text-brand-600 underline">My List</Link>.
          </p>
        </>
      )}
    </div>
  );
}

interface TierSectionProps {
  title: string;
  items: LocalMatch[];
  matches: LocalMatch[];
  offset: number;
  confirm: (idx: number, tag: RelationshipTag, notes: string) => Promise<void>;
  reject: (idx: number) => Promise<void>;
}

function TierSection({ title, items, matches, confirm, reject }: TierSectionProps) {
  if (items.length === 0) return null;
  return (
    <section className="card">
      <h3 className="font-semibold mb-3">
        {title} <span className="text-slate-400 text-sm">({items.length})</span>
      </h3>
      <ul className="divide-y divide-slate-100">
        {items.map((m) => {
          const globalIdx = matches.indexOf(m);
          return (
            <MatchRow
              key={m.matchId}
              match={m}
              onConfirm={(tag, notes) => confirm(globalIdx, tag, notes)}
              onReject={() => reject(globalIdx)}
            />
          );
        })}
      </ul>
    </section>
  );
}

function MatchRow({
  match,
  onConfirm,
  onReject,
}: {
  match: LocalMatch;
  onConfirm: (tag: RelationshipTag, notes: string) => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const [tag, setTag] = useState<RelationshipTag>(match.relationshipTag ?? "friend");
  const [notes, setNotes] = useState(match.notes ?? "");
  const [expanded, setExpanded] = useState(false);
  const v = match.voter;
  const voterName = [v.first_name, v.last_name].filter(Boolean).join(" ");
  const addr = [v.address, v.city, v.zip].filter(Boolean).join(", ");

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium truncate">{match.contactLabel || voterName}</p>
            <span
              className={
                "chip " +
                (match.confidence === "high"
                  ? "bg-emerald-100 text-emerald-700"
                  : match.confidence === "medium"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-600")
              }
            >
              {match.confidence}
            </span>
            {match.state === "confirmed" && (
              <span className="chip bg-brand-500 text-white">confirmed</span>
            )}
            {match.state === "rejected" && (
              <span className="chip bg-rose-100 text-rose-700">rejected</span>
            )}
          </div>
          <p className="text-sm text-slate-600">{voterName}</p>
          <p className="text-sm text-slate-500">{addr}</p>
          <p className="text-xs text-slate-400">
            {v.party ?? "—"} · last voted {v.last_voted ?? "—"}
          </p>
        </div>
        {match.state === "pending" && (
          <div className="flex items-start gap-2">
            {expanded ? (
              <div className="flex flex-col gap-2">
                <select
                  className="input"
                  value={tag}
                  onChange={(e) => setTag(e.target.value as RelationshipTag)}
                >
                  {RELATIONSHIP_TAGS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <textarea
                  className="input min-h-[60px]"
                  placeholder="Notes (optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => onConfirm(tag, notes)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setExpanded(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button type="button" className="btn-primary" onClick={() => setExpanded(true)}>
                  Confirm
                </button>
                <button type="button" className="btn-danger" onClick={onReject}>
                  Reject
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
