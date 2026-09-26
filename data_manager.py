"""
data_manager.py
Handles all data loading, saving, and default structure for the Finance Dashboard.
"""

import fcntl
import json
import os
import tempfile
from contextlib import contextmanager
from datetime import datetime
import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# All private data lives under data/ (git-ignored):
#   data/users.json          accounts (password hashes, API token hashes)
#   data/users/<name>.json   each person's personal book
#   data/family.json         the shared family book
DATA_DIR   = os.environ.get("FINANCE_DATA_DIR", os.path.join(BASE_DIR, "data"))
FAMILY_BOOK = "family"

DEFAULT_DATA = {
    "paychecks": [],
    "investments": [],
    "spending": [],
    "subscriptions": [],
    "goals": [],
    "vacations": [],
    "trip_splits": [],
    "budget_sliders": {
        "needs":   50,
        "wants":   30,
        "savings": 20
    },
    "spending_categories": [
        "Food", "Gas", "Transit/Parking", "Utilities",
        "Entertainment", "Drinks", "Healthcare", "Clothing", "Other"
    ]
}

# The family book budgets household spending, so it starts with household
# categories. The dashboard buckets these into Needs / Wants (see
# FAMILY_BUCKETS in static/app.js).
FAMILY_CATEGORIES = [
    # Needs
    "Groceries", "Housing", "Utilities", "Household", "Kids & School",
    "Healthcare", "Insurance", "Transportation",
    # Wants
    "Family Dining", "Family Trips", "Outings & Activities",
    "Gifts & Celebrations", "Entertainment", "Other",
]


def book_path(owner: str) -> str:
    """Path of a book: a username for a personal book, or FAMILY_BOOK."""
    if owner == FAMILY_BOOK:
        return os.path.join(DATA_DIR, "family.json")
    return os.path.join(DATA_DIR, "users", f"{owner}.json")


def load_data(path: str) -> dict:
    """Load a book from JSON, merging any missing keys from defaults."""
    data = {}
    if os.path.exists(path):
        with open(path, "r") as f:
            data = json.load(f)
    for k, v in DEFAULT_DATA.items():
        if k not in data:
            data[k] = json.loads(json.dumps(v))
    if path == book_path(FAMILY_BOOK):
        data.setdefault("members", [])
        # A family book created before it had its own categories still has the
        # untouched personal defaults; switch it over while nothing uses them.
        if data["spending_categories"] == DEFAULT_DATA["spending_categories"] and not data["spending"]:
            data["spending_categories"] = list(FAMILY_CATEGORIES)
    return data


def save_data(data: dict, path: str) -> None:
    """Persist a book atomically (write to a temp file, then rename over)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise


@contextmanager
def edit_book(path: str):
    """
    Read-modify-write a book under an exclusive file lock, so two family
    members (or the web app and the MCP server) saving at the same time
    can't overwrite each other.  Nothing is saved if the block raises.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = load_data(path)
        yield data
        save_data(data, path)


def make_id() -> str:
    """Generate a unique string ID based on current timestamp."""
    return str(int(datetime.now().timestamp() * 1000))


def parse_amount(v) -> float:
    """
    Safely parse any money-like value to a float.
    Strips leading/trailing whitespace, '$' signs, and ',' thousands separators
    before converting, so all of these are equivalent:
        "$2,847.37"  →  2847.37
        "2847.37"    →  2847.37
        2847.37      →  2847.37
        "$0"         →  0.0
    Returns 0.0 on any parse failure.
    """
    try:
        return float(str(v).strip().replace("$", "").replace(",", ""))
    except (ValueError, TypeError):
        return 0.0


def fmt_money(v) -> str:
    """Format any money-like value as a dollar string (e.g. '$2,847.37')."""
    return f"${parse_amount(v):,.2f}"

def export_to_excel(data: dict, filename: str = "finance_export.xlsx") -> None:
    """Export current data to an Excel file for external use."""
    with pd.ExcelWriter(filename) as writer:
        pd.DataFrame(data.get("paychecks", [])).to_excel(writer, sheet_name="Paychecks", index=False)
        pd.DataFrame(data.get("investments", [])).to_excel(writer, sheet_name="Investments", index=False)
        pd.DataFrame(data.get("spending", [])).to_excel(writer, sheet_name="Spending", index=False)
    
    print(f"Data exported to {filename}")

def import_from_excel(filename: str) -> dict:
    """Import data from an Excel file, returning a dict in the same format as load_data()."""
    
    "Excel file will have 3 column headers: 'Amount', 'Date', 'Description' and be organized like this:\n\n"
    
    if not os.path.exists(filename):
        print(f"File {filename} does not exist.")
        return {}
    
    data = {}
    try:
        with pd.ExcelFile(filename) as xls:
            if "Paychecks" in xls.sheet_names:
                data["paychecks"] = pd.read_excel(xls, sheet_name="Paychecks").to_dict(orient="records")
            if "Investments" in xls.sheet_names:
                data["investments"] = pd.read_excel(xls, sheet_name="Investments").to_dict(orient="records")
            if "Spending" in xls.sheet_names:
                data["spending"] = pd.read_excel(xls, sheet_name="Spending").to_dict(orient="records")
    except Exception as e:
        print(f"Error importing from Excel: {e}")
        return {}
    
    return data
