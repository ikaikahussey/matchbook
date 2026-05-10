"""Voter Match — single-process Flask app.

Run with:
    pip install -r requirements.txt
    python app.py

Config via environment:
    VOTER_MATCH_DB       Path to SQLite file (default: voter_match.db)
    VOTER_MATCH_SECRET   Flask session secret (required for production)
    HOST, PORT           Bind address (default 0.0.0.0:8000)
"""
import os
from functools import wraps

from flask import (Flask, Response, abort, g, jsonify, redirect, render_template,
                   request, session, url_for)

from voter_match import codenames as cn
from voter_match import db as dbmod
from voter_match import walk_sheet

MAX_HASHES_PER_REQUEST = 5000
RELATIONSHIP_TAGS = {"family", "friend", "neighbor", "coworker", "acquaintance"}
SESSION_TTL_SECONDS = 60 * 60 * 8

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB voter file cap
app.secret_key = os.environ.get("VOTER_MATCH_SECRET") or "dev-secret-change-me"
DB_PATH = os.environ.get("VOTER_MATCH_DB", "voter_match.db")

_conn = dbmod.connect(DB_PATH)
dbmod.init_schema(_conn)
dbmod.seed_demo(_conn)


def db():
    if "db" not in g:
        g.db = _conn
    return g.db


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def current_session():
    s = session.get("vm")
    return s if isinstance(s, dict) else None


def require_session(role=None):
    def deco(fn):
        @wraps(fn)
        def wrapped(*a, **kw):
            s = current_session()
            if not s:
                if request.path.startswith("/api/"):
                    return jsonify(error="not authenticated"), 401
                return redirect(url_for("login_page"))
            if role and s.get("role") != role:
                if request.path.startswith("/api/"):
                    return jsonify(error=f"{role} only"), 403
                abort(403)
            return fn(*a, **kw)
        return wrapped
    return deco


def get_campaign(campaign_id):
    return db().execute("SELECT * FROM campaigns WHERE id = ?", (campaign_id,)).fetchone()


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    s = current_session()
    if not s:
        return redirect(url_for("login_page"))
    if s["role"] == "admin":
        return redirect(url_for("admin_page"))
    if not s.get("terms_accepted"):
        return redirect(url_for("terms_page"))
    return redirect(url_for("match_page"))


@app.route("/login", methods=["GET"])
def login_page():
    return render_template("login.html", error=request.args.get("error"))


@app.route("/login", methods=["POST"])
def login_submit():
    code = (request.form.get("access_code") or "").strip().upper()
    phone = (request.form.get("phone") or "").strip()
    if not code or not phone:
        return redirect(url_for("login_page", error="access code and phone required"))

    camp = db().execute("SELECT * FROM campaigns WHERE access_code = ?", (code,)).fetchone()
    if not camp:
        return redirect(url_for("login_page", error="invalid access code"))

    user_id = dbmod.upsert_user_by_phone(db(), phone)
    existing = db().execute(
        "SELECT id, terms_accepted_at, codename FROM volunteers "
        "WHERE campaign_id = ? AND user_id = ?",
        (camp["id"], user_id),
    ).fetchone()

    if existing:
        vol_id = existing["id"]
        terms_accepted = existing["terms_accepted_at"] is not None
        codename = existing["codename"] or dbmod.allocate_codename(db(), camp["id"])
        if not existing["codename"]:
            db().execute("UPDATE volunteers SET codename = ? WHERE id = ?", (codename, vol_id))
    else:
        vol_id = dbmod.random_id("vol")
        codename = dbmod.allocate_codename(db(), camp["id"])
        db().execute(
            "INSERT INTO volunteers (id, user_id, campaign_id, phone, codename, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (vol_id, user_id, camp["id"], phone, codename, dbmod.now_ms()),
        )
        terms_accepted = False

    session.permanent = True
    app.permanent_session_lifetime = SESSION_TTL_SECONDS
    session["vm"] = {
        "role": "volunteer",
        "volunteer_id": vol_id,
        "user_id": user_id,
        "campaign_id": camp["id"],
        "campaign_name": camp["name"],
        "salt": camp["salt"],
        "codename": codename,
        "terms_accepted": terms_accepted,
    }
    dbmod.record_audit(db(), volunteer_id=vol_id, campaign_id=camp["id"], action="login")
    return redirect(url_for("index"))


@app.route("/admin/login", methods=["POST"])
def admin_login():
    code = (request.form.get("admin_code") or "").strip().upper()
    if not code:
        return redirect(url_for("login_page", error="admin code required"))
    camp = db().execute("SELECT * FROM campaigns WHERE admin_code = ?", (code,)).fetchone()
    if not camp:
        return redirect(url_for("login_page", error="invalid admin code"))
    session.permanent = True
    app.permanent_session_lifetime = SESSION_TTL_SECONDS
    session["vm"] = {
        "role": "admin",
        "volunteer_id": None,
        "campaign_id": camp["id"],
        "campaign_name": camp["name"],
        "salt": camp["salt"],
        "terms_accepted": True,
    }
    dbmod.record_audit(db(), volunteer_id=None, campaign_id=camp["id"], action="admin_login")
    return redirect(url_for("admin_page"))


@app.route("/logout", methods=["POST"])
def logout():
    session.pop("vm", None)
    return redirect(url_for("login_page"))


@app.route("/terms", methods=["GET"])
@require_session("volunteer")
def terms_page():
    s = current_session()
    if s.get("terms_accepted"):
        return redirect(url_for("match_page"))
    return render_template("terms.html", session=s)


@app.route("/terms", methods=["POST"])
@require_session("volunteer")
def terms_accept():
    s = current_session()
    db().execute("UPDATE volunteers SET terms_accepted_at = ? WHERE id = ?",
                 (dbmod.now_ms(), s["volunteer_id"]))
    s["terms_accepted"] = True
    session["vm"] = s
    dbmod.record_audit(db(), volunteer_id=s["volunteer_id"],
                       campaign_id=s["campaign_id"], action="terms_accepted")
    return redirect(url_for("match_page"))


@app.route("/match")
@require_session("volunteer")
def match_page():
    s = current_session()
    if not s.get("terms_accepted"):
        return redirect(url_for("terms_page"))
    return render_template("match.html", session=s,
                           max_hashes=MAX_HASHES_PER_REQUEST,
                           tags=sorted(RELATIONSHIP_TAGS))


@app.route("/my-list")
@require_session("volunteer")
def my_list_page():
    s = current_session()
    precinct = request.args.get("precinct") or None
    tag = request.args.get("tag") or None
    include_pending = request.args.get("pending") == "1"
    rows = _fetch_my_list(s["volunteer_id"], precinct, tag, include_pending)
    districts = [r["name"] for r in db().execute(
        "SELECT name FROM districts WHERE campaign_id = ? ORDER BY name",
        (s["campaign_id"],))]
    return render_template("my_list.html", session=s, rows=rows,
                           districts=districts, tags=sorted(RELATIONSHIP_TAGS),
                           filter_precinct=precinct, filter_tag=tag,
                           include_pending=include_pending)


@app.route("/relationships")
@require_session("volunteer")
def relationships_page():
    s = current_session()
    rows = db().execute(
        "SELECT m.id AS match_id, v.campaign_id, c.name AS campaign_name, v.codename, "
        "       m.voter_id, vr.first_name, vr.last_name, vr.city, vr.zip, "
        "       d.name AS district_name, m.relationship_tag, m.notes, m.updated_at "
        "FROM volunteers v "
        "JOIN campaigns c ON c.id = v.campaign_id "
        "JOIN matches m ON m.volunteer_id = v.id "
        "JOIN voter_records vr ON vr.voter_id = m.voter_id AND vr.campaign_id = v.campaign_id "
        "LEFT JOIN districts d ON d.id = vr.district_id "
        "WHERE v.user_id = ? AND m.confirmed = 1 AND m.rejected = 0 "
        "ORDER BY c.name, m.updated_at DESC",
        (s["user_id"],),
    ).fetchall()
    grouped = {}
    for r in rows:
        g_ = grouped.setdefault(r["campaign_id"], {
            "campaign_id": r["campaign_id"],
            "campaign_name": r["campaign_name"],
            "codename": r["codename"],
            "items": [],
        })
        g_["items"].append(r)
    return render_template("relationships.html", session=s, groups=list(grouped.values()))


@app.route("/admin")
@require_session("admin")
def admin_page():
    s = current_session()
    stats = _admin_stats(s["campaign_id"])
    camp = get_campaign(s["campaign_id"])
    return render_template("admin.html", session=s, stats=stats,
                           voter_file_version=camp["voter_file_version"])


@app.route("/admin/voter-file", methods=["POST"])
@require_session("admin")
def admin_upload_voter_file():
    s = current_session()
    file = request.files.get("file")
    if not file:
        return redirect(url_for("admin_page"))
    text = file.read().decode("utf-8", errors="replace")
    try:
        result = dbmod.ingest_voter_file(db(), s["campaign_id"], s["salt"], text)
    except ValueError as exc:
        return render_template("admin.html", session=s,
                               stats=_admin_stats(s["campaign_id"]),
                               voter_file_version=get_campaign(s["campaign_id"])["voter_file_version"],
                               error=str(exc)), 400

    # Stash the raw upload alongside the DB so prior versions remain auditable.
    raw_dir = os.path.join(os.path.dirname(os.path.abspath(DB_PATH)), "voter_files")
    os.makedirs(raw_dir, exist_ok=True)
    fname = f"{s['campaign_id']}-{dbmod.now_ms()}.csv"
    with open(os.path.join(raw_dir, fname), "w", encoding="utf-8") as fh:
        fh.write(text)

    dbmod.record_audit(db(), volunteer_id=None, campaign_id=s["campaign_id"],
                       action="voter_file_upload", target_id=fname,
                       metadata={"inserted": result["inserted"], "version": result["version"]})
    return render_template("admin.html", session=s,
                           stats=_admin_stats(s["campaign_id"]),
                           voter_file_version=get_campaign(s["campaign_id"])["voter_file_version"],
                           ingest=result)


@app.route("/codename", methods=["POST"])
@require_session("volunteer")
def change_codename():
    s = current_session()
    codename = (request.form.get("codename") or "").strip().lower()
    if not cn.is_valid(codename):
        return redirect(url_for("relationships_page"))
    taken = db().execute(
        "SELECT 1 FROM volunteers WHERE campaign_id = ? AND codename = ? AND id != ?",
        (s["campaign_id"], codename, s["volunteer_id"]),
    ).fetchone()
    if taken:
        return redirect(url_for("relationships_page"))
    db().execute("UPDATE volunteers SET codename = ? WHERE id = ?",
                 (codename, s["volunteer_id"]))
    s["codename"] = codename
    session["vm"] = s
    dbmod.record_audit(db(), volunteer_id=s["volunteer_id"],
                       campaign_id=s["campaign_id"], action="codename_change",
                       metadata={"codename": codename})
    return redirect(url_for("relationships_page"))


@app.route("/switch-campaign", methods=["POST"])
@require_session("volunteer")
def switch_campaign():
    s = current_session()
    target = (request.form.get("campaign_id") or "").strip()
    if not target:
        return redirect(url_for("index"))
    membership = db().execute(
        "SELECT id, terms_accepted_at, codename FROM volunteers WHERE user_id = ? AND campaign_id = ?",
        (s["user_id"], target),
    ).fetchone()
    if not membership:
        abort(403)
    camp = get_campaign(target)
    if not camp:
        abort(404)
    s.update({
        "volunteer_id": membership["id"],
        "campaign_id": camp["id"],
        "campaign_name": camp["name"],
        "salt": camp["salt"],
        "codename": membership["codename"],
        "terms_accepted": membership["terms_accepted_at"] is not None,
    })
    session["vm"] = s
    dbmod.record_audit(db(), volunteer_id=membership["id"],
                       campaign_id=camp["id"], action="campaign_switch")
    return redirect(url_for("index"))


# ---------------------------------------------------------------------------
# JSON API (called by browser-side hashing)
# ---------------------------------------------------------------------------

@app.route("/api/match", methods=["POST"])
@require_session("volunteer")
def api_match():
    s = current_session()
    if not s.get("terms_accepted"):
        return jsonify(error="terms not accepted"), 403

    body = request.get_json(silent=True) or {}
    hashes = body.get("hashes") or {}
    phone = hashes.get("phone") or []
    name_zip = hashes.get("nameZip") or []
    name_addr = hashes.get("nameAddr") or []
    total = len(phone) + len(name_zip) + len(name_addr)
    if total == 0:
        return jsonify(matches=[])
    if total > MAX_HASHES_PER_REQUEST:
        return jsonify(error=f"too many hashes (max {MAX_HASHES_PER_REQUEST})"), 400

    import re
    hex64 = re.compile(r"^[0-9a-f]{64}$")
    for h in (*phone, *name_zip, *name_addr):
        if not isinstance(h, str) or not hex64.match(h):
            return jsonify(error="hashes must be 64-char hex strings"), 400

    # Look up each hash type, keeping the highest-confidence tier per voter.
    conn = db()
    found = []  # (voter_id, type, hash)
    if phone:
        rows = conn.execute(
            f"SELECT voter_id, phone_hash FROM voter_records "
            f"WHERE campaign_id = ? AND phone_hash IN ({','.join('?' * len(phone))})",
            (s["campaign_id"], *phone),
        ).fetchall()
        for r in rows:
            found.append((r["voter_id"], "phone", r["phone_hash"]))
    if name_addr:
        rows = conn.execute(
            f"SELECT voter_id, name_addr_hash FROM voter_records "
            f"WHERE campaign_id = ? AND name_addr_hash IN ({','.join('?' * len(name_addr))})",
            (s["campaign_id"], *name_addr),
        ).fetchall()
        for r in rows:
            found.append((r["voter_id"], "name_addr", r["name_addr_hash"]))
    if name_zip:
        rows = conn.execute(
            f"SELECT voter_id, name_zip_hash FROM voter_records "
            f"WHERE campaign_id = ? AND name_zip_hash IN ({','.join('?' * len(name_zip))})",
            (s["campaign_id"], *name_zip),
        ).fetchall()
        for r in rows:
            found.append((r["voter_id"], "name_zip", r["name_zip_hash"]))

    tier_rank = {"phone": 3, "name_addr": 2, "name_zip": 1}
    best = {}
    for voter_id, typ, h in found:
        cur = best.get(voter_id)
        if not cur or tier_rank[typ] > tier_rank[cur[0]]:
            best[voter_id] = (typ, h)

    if not best:
        dbmod.record_audit(conn, volunteer_id=s["volunteer_id"],
                           campaign_id=s["campaign_id"], action="match_search",
                           metadata={"hashCount": total, "matched": 0})
        return jsonify(matches=[])

    voter_ids = list(best.keys())
    placeholders = ",".join("?" * len(voter_ids))
    voters = {r["voter_id"]: r for r in conn.execute(
        f"SELECT * FROM voter_records WHERE campaign_id = ? AND voter_id IN ({placeholders})",
        (s["campaign_id"], *voter_ids),
    ).fetchall()}

    now = dbmod.now_ms()
    out = []
    for voter_id, (match_type, matched_hash) in best.items():
        voter = voters.get(voter_id)
        if not voter:
            continue
        confidence = "high" if match_type in ("phone", "name_addr") else "medium"
        existing = conn.execute(
            "SELECT id FROM matches WHERE volunteer_id = ? AND voter_id = ?",
            (s["volunteer_id"], voter_id),
        ).fetchone()
        if existing:
            match_id = existing["id"]
            conn.execute(
                "UPDATE matches SET match_type = ?, confidence = ?, updated_at = ? WHERE id = ?",
                (match_type, confidence, now, match_id),
            )
        else:
            match_id = dbmod.random_id("mat")
            conn.execute(
                "INSERT INTO matches (id, volunteer_id, voter_id, campaign_id, confidence, "
                "match_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (match_id, s["volunteer_id"], voter_id, s["campaign_id"],
                 confidence, match_type, now, now),
            )
        out.append({
            "matchId": match_id,
            "voter": _voter_dict(voter),
            "matchType": match_type,
            "confidence": confidence,
            "matchedHash": matched_hash,
        })

    dbmod.record_audit(conn, volunteer_id=s["volunteer_id"],
                       campaign_id=s["campaign_id"], action="match_search",
                       metadata={"hashCount": total, "matched": len(out)})
    return jsonify(matches=out)


@app.route("/api/matches/<match_id>/confirm", methods=["POST"])
@require_session("volunteer")
def api_confirm(match_id):
    s = current_session()
    body = request.get_json(silent=True) or {}
    tag = body.get("relationshipTag") or None
    notes = body.get("notes") or None
    if tag and tag not in RELATIONSHIP_TAGS:
        return jsonify(error="invalid relationshipTag"), 400
    existing = db().execute("SELECT id FROM matches WHERE id = ? AND volunteer_id = ?",
                            (match_id, s["volunteer_id"])).fetchone()
    if not existing:
        return jsonify(error="match not found"), 404
    db().execute(
        "UPDATE matches SET confirmed = 1, rejected = 0, relationship_tag = ?, notes = ?, "
        "updated_at = ? WHERE id = ?",
        (tag, notes, dbmod.now_ms(), match_id),
    )
    dbmod.record_audit(db(), volunteer_id=s["volunteer_id"],
                       campaign_id=s["campaign_id"], action="match_confirm",
                       target_id=match_id, metadata={"relationshipTag": tag})
    return jsonify(ok=True)


@app.route("/api/matches/<match_id>/reject", methods=["POST"])
@require_session("volunteer")
def api_reject(match_id):
    s = current_session()
    existing = db().execute("SELECT id FROM matches WHERE id = ? AND volunteer_id = ?",
                            (match_id, s["volunteer_id"])).fetchone()
    if not existing:
        return jsonify(error="match not found"), 404
    db().execute("UPDATE matches SET confirmed = 0, rejected = 1, updated_at = ? WHERE id = ?",
                 (dbmod.now_ms(), match_id))
    dbmod.record_audit(db(), volunteer_id=s["volunteer_id"],
                       campaign_id=s["campaign_id"], action="match_reject",
                       target_id=match_id)
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# Exports
# ---------------------------------------------------------------------------

@app.route("/my-list/export.csv")
@require_session("volunteer")
def export_csv():
    s = current_session()
    rows = _fetch_my_list(s["volunteer_id"],
                          request.args.get("precinct") or None,
                          request.args.get("tag") or None,
                          False)
    import csv as _csv
    from io import StringIO
    buf = StringIO()
    w = _csv.writer(buf)
    w.writerow(["VanID", "LastName", "FirstName", "StreetAddress", "City", "Zip5",
                "Party", "RelationshipTag", "Notes"])
    for r in rows:
        w.writerow([r["voter_id"], r["last_name"] or "", r["first_name"] or "",
                    r["address"] or "", r["city"] or "", r["zip"] or "",
                    r["party"] or "", r["relationship_tag"] or "", r["notes"] or ""])
    dbmod.record_audit(db(), volunteer_id=s["volunteer_id"],
                       campaign_id=s["campaign_id"], action="my_list_export_csv",
                       metadata={"count": len(rows)})
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="my-list.csv"'})


@app.route("/my-list/export.pdf")
@require_session("volunteer")
def export_pdf():
    s = current_session()
    rows = _fetch_my_list(s["volunteer_id"],
                          request.args.get("precinct") or None,
                          request.args.get("tag") or None,
                          False)
    pdf = walk_sheet.build([dict(r) for r in rows])
    dbmod.record_audit(db(), volunteer_id=s["volunteer_id"],
                       campaign_id=s["campaign_id"], action="my_list_export_pdf",
                       metadata={"count": len(rows)})
    return Response(pdf, mimetype="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="walk-sheet.pdf"'})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _voter_dict(row):
    return {
        "voter_id": row["voter_id"],
        "campaign_id": row["campaign_id"],
        "district_id": row["district_id"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "address": row["address"],
        "city": row["city"],
        "zip": row["zip"],
        "party": row["party"],
        "last_voted": row["last_voted"],
    }


def _fetch_my_list(volunteer_id, precinct, tag, include_pending):
    conds = ["m.volunteer_id = ?", "m.rejected = 0"]
    args = [volunteer_id]
    if not include_pending:
        conds.append("m.confirmed = 1")
    if precinct:
        conds.append("d.name = ?")
        args.append(precinct)
    if tag:
        conds.append("m.relationship_tag = ?")
        args.append(tag)
    sql = (
        "SELECT m.id AS match_id, m.voter_id, m.confirmed, m.rejected, "
        "       m.relationship_tag, m.notes, m.created_at, m.updated_at, "
        "       m.confidence, m.match_type, "
        "       v.first_name, v.last_name, v.address, v.city, v.zip, "
        "       v.party, v.last_voted, v.district_id, d.name AS district_name "
        "FROM matches m "
        "JOIN voter_records v ON v.voter_id = m.voter_id AND v.campaign_id = m.campaign_id "
        "LEFT JOIN districts d ON d.id = v.district_id "
        f"WHERE {' AND '.join(conds)} ORDER BY m.updated_at DESC"
    )
    return db().execute(sql, args).fetchall()


def _admin_stats(campaign_id):
    conn = db()
    volunteers = conn.execute(
        "SELECT COUNT(*) AS n FROM volunteers WHERE campaign_id = ?", (campaign_id,)
    ).fetchone()["n"]
    unique_voters = conn.execute(
        "SELECT COUNT(DISTINCT m.voter_id) AS n FROM matches m "
        "WHERE m.campaign_id = ? AND m.confirmed = 1", (campaign_id,)
    ).fetchone()["n"]
    coverage = conn.execute(
        "SELECT d.name AS district, "
        "       COUNT(DISTINCT v.voter_id) AS total, "
        "       COUNT(DISTINCT CASE WHEN m.confirmed = 1 THEN m.voter_id END) AS covered "
        "FROM districts d "
        "LEFT JOIN voter_records v ON v.district_id = d.id "
        "LEFT JOIN matches m ON m.voter_id = v.voter_id AND m.campaign_id = v.campaign_id "
        "WHERE d.campaign_id = ? GROUP BY d.id, d.name", (campaign_id,)
    ).fetchall()
    return {
        "volunteers_enrolled": volunteers,
        "unique_voters": unique_voters,
        "coverage": [
            {"district": r["district"], "total": r["total"], "covered": r["covered"],
             "percent": round(r["covered"] / r["total"] * 100, 1) if r["total"] else 0.0}
            for r in coverage
        ],
    }


@app.context_processor
def inject_session():
    return {"vm_session": current_session()}


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    app.run(host=host, port=port, debug=os.environ.get("DEBUG") == "1")
