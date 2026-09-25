"""
Family Finance Dashboard — Flask web app.
Run:  python web_app.py
Then open http://localhost:5050 in your browser.

Each family member has a personal book, and everyone shares the family book.
Accounts are managed with manage_users.py.
"""

from flask import Flask, render_template, request, jsonify, send_file, session, redirect, url_for
import io
import os
import secrets
import tempfile
from datetime import date as _date, timedelta
from functools import wraps
from dotenv import load_dotenv
from data_manager import (DATA_DIR, FAMILY_BOOK, book_path, load_data, edit_book, make_id,
                          parse_amount, export_to_excel, import_from_excel)
from receipt_parser import parse_receipt_image
import auth

# Load environment variables from a local .env file if present
# (FINANCE_SECRET_KEY, ANTHROPIC_API_KEY, FINANCE_HOST, ...).
load_dotenv()


def _secret_key() -> str:
    """FINANCE_SECRET_KEY from the environment, else one generated once and kept in data/."""
    if os.environ.get("FINANCE_SECRET_KEY"):
        return os.environ["FINANCE_SECRET_KEY"]
    path = os.path.join(DATA_DIR, "secret_key")
    if not os.path.exists(path):
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(os.open(path, os.O_WRONLY | os.O_CREAT, 0o600), "w") as f:
            f.write(secrets.token_hex(32))
    with open(path) as f:
        return f.read().strip()


app = Flask(__name__)
app.config.update(
    SECRET_KEY=_secret_key(),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),  # stay signed in on phones
)

FREQ_MULTIPLIERS = {
    "one-time":    0.0,
    "weekly":      52 / 12,
    "biweekly":    26 / 12,
    "semimonthly": 2.0,
    "monthly":     1.0,
    "quarterly":   1 / 3,
    "annually":    1 / 12,
}

DEFAULT_COLLECTIONS = ["paychecks", "investments", "spending", "subscriptions", "goals", "vacations"]

def monthly_amount(p):
    return parse_amount(p.get("amount", 0)) * FREQ_MULTIPLIERS.get(p.get("frequency", "monthly"), 1.0)


# ── Auth & books ───────────────────────────────────────────────────────────────

def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if session.get("user") not in auth.load_users():
            session.clear()
            if request.path.startswith("/api/"):
                return jsonify({"ok": False, "error": "Not signed in"}), 401
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def _book_owner(book: str) -> str:
    return FAMILY_BOOK if book == "family" else session["user"]


def current_book() -> str:
    """'personal' or 'family' — which book the dashboard is looking at."""
    return session.get("book", "personal")


def current_path() -> str:
    return book_path(_book_owner(current_book()))


@app.route("/login", methods=["GET", "POST"])
def login():
    error = hint = None
    username = ""
    if request.method == "POST" and request.form.get("action") == "hint":
        username = request.form.get("username", "").strip().lower()
        hint = auth.password_hint(username) or "No hint is set for that username."
    elif request.method == "POST":
        username = request.form.get("username", "").strip().lower()
        if auth.verify_password(username, request.form.get("password", "")):
            session.clear()
            session.permanent = True
            session["user"] = username
            nxt = request.args.get("next", "")
            return redirect(nxt if nxt.startswith("/") and not nxt.startswith("//") else url_for("index"))
        error = "Wrong username or password."
    return render_template("login.html", error=error, hint=hint, username=username,
                           no_users=not auth.load_users())


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/api/book", methods=["POST"])
@login_required
def switch_book():
    book = (request.json or {}).get("book")
    if book not in ("personal", "family"):
        return jsonify({"ok": False, "error": "book must be 'personal' or 'family'"}), 400
    session["book"] = book
    return jsonify({"ok": True, "book": book})


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/")
@login_required
def index():
    return render_template("index.html", user=session["user"],
                           display_name=auth.display_name(session["user"]), book=current_book())


@app.route("/api/data")
@login_required
def get_data():
    d = load_data(current_path())
    mi = sum(monthly_amount(p) for p in d["paychecks"])
    d["_computed"] = {
        "monthly_income": round(mi, 2),
        "annual_income":  round(mi * 12, 2),
    }
    d["_book"] = current_book()
    return jsonify(d)


def _upsert(collection, rec, path=None, user=None):
    path = path or current_path()
    user = user or session["user"]
    with edit_book(path) as data:
        if not rec.get("id"):
            rec["id"] = make_id()
        col = data.setdefault(collection, [])
        idx = next((i for i, x in enumerate(col) if x["id"] == rec["id"]), None)
        if idx is not None:
            # Keep who originally added a shared record through later edits
            if "added_by" in col[idx]:
                rec.setdefault("added_by", col[idx]["added_by"])
            col[idx] = rec
        else:
            if path == book_path(FAMILY_BOOK):
                rec.setdefault("added_by", user)
            col.append(rec)
    return rec["id"]


def _delete(collection, item_id):
    with edit_book(current_path()) as data:
        if collection in data:
            data[collection] = [x for x in data[collection] if x["id"] != item_id]


@app.route("/api/paychecks", methods=["POST"])
@login_required
def save_paycheck():
    return jsonify({"ok": True, "id": _upsert("paychecks", request.json)})

@app.route("/api/paychecks/<pid>", methods=["DELETE"])
@login_required
def delete_paycheck(pid):
    _delete("paychecks", pid)
    return jsonify({"ok": True})


@app.route("/api/investments", methods=["POST"])
@login_required
def save_investment():
    return jsonify({"ok": True, "id": _upsert("investments", request.json)})

@app.route("/api/investments/<iid>", methods=["DELETE"])
@login_required
def delete_investment(iid):
    _delete("investments", iid)
    return jsonify({"ok": True})


@app.route("/api/spending", methods=["POST"])
@login_required
def save_spending():
    return jsonify({"ok": True, "id": _upsert("spending", request.json)})

@app.route("/api/spending/<sid>", methods=["DELETE"])
@login_required
def delete_spending(sid):
    _delete("spending", sid)
    return jsonify({"ok": True})


@app.route("/api/subscriptions", methods=["POST"])
@login_required
def save_subscription():
    return jsonify({"ok": True, "id": _upsert("subscriptions", request.json)})

@app.route("/api/subscriptions/<sid>", methods=["DELETE"])
@login_required
def delete_subscription(sid):
    _delete("subscriptions", sid)
    return jsonify({"ok": True})


@app.route("/api/goals", methods=["POST"])
@login_required
def save_goal():
    return jsonify({"ok": True, "id": _upsert("goals", request.json)})

@app.route("/api/goals/<gid>", methods=["DELETE"])
@login_required
def delete_goal(gid):
    _delete("goals", gid)
    return jsonify({"ok": True})


@app.route("/api/vacations", methods=["POST"])
@login_required
def save_vacation():
    return jsonify({"ok": True, "id": _upsert("vacations", request.json)})

@app.route("/api/vacations/<vid>", methods=["DELETE"])
@login_required
def delete_vacation(vid):
    _delete("vacations", vid)
    return jsonify({"ok": True})


@app.route("/api/trip_splits", methods=["POST"])
@login_required
def save_trip_split():
    return jsonify({"ok": True, "id": _upsert("trip_splits", request.json)})

@app.route("/api/trip_splits/<tid>", methods=["DELETE"])
@login_required
def delete_trip_split(tid):
    _delete("trip_splits", tid)
    return jsonify({"ok": True})


@app.route("/api/budget_sliders", methods=["POST"])
@login_required
def save_sliders():
    with edit_book(current_path()) as data:
        data["budget_sliders"] = request.json
    return jsonify({"ok": True})


@app.route("/api/categories", methods=["POST"])
@login_required
def save_categories():
    with edit_book(current_path()) as data:
        data["spending_categories"] = request.json.get("categories", data["spending_categories"])
    return jsonify({"ok": True})


@app.route("/api/export")
@login_required
def export_data():
    buf = io.BytesIO()
    export_to_excel(load_data(current_path()), buf)
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name=f"finance_{current_book()}_export.xlsx")


@app.route("/api/import", methods=["POST"])
@login_required
def import_data():
    """
    Accept an uploaded .xlsx file (exported by this app or matching the sheet structure:
    sheets named 'Paychecks', 'Investments', 'Spending', each with the same columns
    as the export).  Query param ?merge=true (default) merges new records;
    merge=false replaces each collection entirely.
    """
    f = request.files.get("file")
    if not f:
        return jsonify({"ok": False, "error": "No file uploaded"}), 400

    fd, tmp = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    try:
        f.save(tmp)
        imported = import_from_excel(tmp)
    finally:
        os.unlink(tmp)
    if not imported:
        return jsonify({"ok": False, "error": "Could not read file — check sheet names"}), 400

    merge = request.args.get("merge", "true").lower() != "false"
    counts = {}
    with edit_book(current_path()) as data:
        for key in ["paychecks", "investments", "spending"]:
            rows = imported.get(key) or []
            # strip NaN / None id rows that pandas sometimes produces
            rows = [r for r in rows if r.get("id") and str(r["id"]).strip() not in ("", "nan")]
            counts[key] = len(rows)
            if not rows:
                continue
            if merge:
                existing_ids = {str(x.get("id", "")) for x in data.get(key, [])}
                for rec in rows:
                    rec["id"] = str(rec["id"])
                    if rec["id"] not in existing_ids:
                        data.setdefault(key, []).append(rec)
            else:
                data[key] = rows

    return jsonify({"ok": True, "counts": counts, "merge": merge})


@app.route("/api/parse-receipt", methods=["POST"])
@login_required
def parse_receipt():
    f = request.files.get("image")
    if not f:
        return jsonify({"ok": False, "error": "No image uploaded"}), 400

    raw = f.read()
    if not raw:
        return jsonify({"ok": False, "error": "Uploaded image is empty"}), 400

    # Parse locally with on-device OCR (macOS Vision) — no API key required.
    try:
        parsed = parse_receipt_image(raw)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Could not read receipt: {e}"}), 500

    return jsonify({"ok": True, **parsed})


# ── Phone quick-add ────────────────────────────────────────────────────────────
# /quick is a small mobile page (sign in once, add it to your Home Screen).
# /api/quick-add also accepts "Authorization: Bearer <token>" for iOS Shortcuts;
# create a token with:  python manage_users.py token <username>

def _request_user():
    """Signed-in user from the session, or from a Bearer API token."""
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return auth.user_for_token(header[len("Bearer "):].strip())
    user = session.get("user")
    return user if user in auth.load_users() else None


@app.route("/quick")
@login_required
def quick():
    return render_template("quick.html", display_name=auth.display_name(session["user"]))


@app.route("/api/quick-info")
@login_required
def quick_info():
    books = {}
    for book in ("personal", "family"):
        d = load_data(book_path(_book_owner(book)))
        # Most recently *added* first (ids are creation timestamps), so a new entry shows up on top
        recent = sorted(d["spending"], key=lambda e: int(e["id"]) if str(e.get("id", "")).isdigit() else 0, reverse=True)[:5]
        books[book] = {"categories": d["spending_categories"], "recent": recent}
    return jsonify({"ok": True, "today": str(_date.today()), "books": books})


@app.route("/api/quick-add", methods=["POST"])
def quick_add():
    """
    JSON body: {"amount": 12.5, "category": "Food", "notes": "...", "date": "YYYY-MM-DD",
                "book": "personal" | "family"}
    or just {"text": "twelve fifty for lunch", "book": ...} to have Claude parse it
    (needs ANTHROPIC_API_KEY).
    """
    user = _request_user()
    if not user:
        return jsonify({"ok": False, "error": "Not signed in"}), 401

    body = request.get_json(force=True, silent=True) or {}
    book = body.get("book", "personal")
    if book not in ("personal", "family"):
        return jsonify({"ok": False, "error": "book must be 'personal' or 'family'"}), 400
    path = book_path(FAMILY_BOOK if book == "family" else user)
    categories = load_data(path)["spending_categories"]

    if body.get("text") and not body.get("amount"):
        if not os.environ.get("ANTHROPIC_API_KEY"):
            return jsonify({"ok": False, "error": "Free-text entry needs ANTHROPIC_API_KEY on the server"}), 400
        from expense_parser import parse_expense_text
        try:
            body = {**body, **parse_expense_text(body["text"], categories)}
        except Exception as e:
            return jsonify({"ok": False, "error": f"Could not understand that: {e}"}), 400

    amount = round(parse_amount(body.get("amount")), 2)
    if amount <= 0:
        return jsonify({"ok": False, "error": "Amount must be more than 0"}), 400
    # Match categories case-insensitively; unknown ones fall back to Other
    category = next((c for c in categories if c.lower() == str(body.get("category", "")).strip().lower()), "Other")
    entry = {
        "category": category,
        "amount":   str(amount),
        "date":     body.get("date") or str(_date.today()),
        "notes":    str(body.get("notes", "")).strip(),
    }
    _upsert("spending", entry, path=path, user=user)

    msg = f"Logged ${amount:.2f} {category} to {'Family' if book == 'family' else 'Personal'}"
    if entry["notes"]:
        msg += f" ({entry['notes']})"
    return jsonify({"ok": True, "message": msg, "entry": entry})


if __name__ == "__main__":
    # Defaults to localhost only. To reach it from your phone over Tailscale,
    # prefer `tailscale serve --bg 5050` (HTTPS, tailnet-only) — see README.
    host  = os.environ.get("FINANCE_HOST", "127.0.0.1")
    port  = int(os.environ.get("FINANCE_PORT", "5050"))
    debug = os.environ.get("FLASK_DEBUG") == "1"
    if debug and host not in ("127.0.0.1", "localhost"):
        raise SystemExit("Refusing to run the Flask debugger on a non-local address (it allows remote code execution).")
    if not auth.load_users():
        print("No accounts yet — create one first:  python manage_users.py add <username>")
    print(f"Finance Dashboard → http://{host}:{port}")
    app.run(host=host, port=port, debug=debug, threaded=True)
