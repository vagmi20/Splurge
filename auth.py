"""
auth.py
Family accounts for the Finance Dashboard.

Accounts live in data/users.json (git-ignored):
    {"users": {"<username>": {"display_name": ..., "password_hash": ...,
                              "hint": ..., "token_hashes": [...]}}}
Passwords are stored as salted hashes; phone API tokens as SHA-256 hashes,
so the plaintext of either is never written to disk.
"""

import hashlib
import hmac
import json
import os
import re
import secrets

from werkzeug.security import check_password_hash, generate_password_hash

from data_manager import DATA_DIR, save_data

USERS_FILE = os.path.join(DATA_DIR, "users.json")
USERNAME_RE = re.compile(r"^[a-z0-9_-]{2,32}$")
RESERVED_USERNAMES = {"family"}  # the shared book isn't a person; everyone already has access

# Used to spend the same time on unknown usernames as on wrong passwords.
_DUMMY_HASH = generate_password_hash("not-a-real-password")


def load_users() -> dict:
    if not os.path.exists(USERS_FILE):
        return {}
    with open(USERS_FILE) as f:
        return json.load(f).get("users", {})


def save_users(users: dict) -> None:
    save_data({"users": users}, USERS_FILE)


def display_name(username: str) -> str:
    return load_users().get(username, {}).get("display_name", username)


def password_hint(username: str):
    """The password hint a user set for themselves, or None."""
    return load_users().get(username, {}).get("hint") or None


def verify_password(username: str, password: str) -> bool:
    user = load_users().get(username)
    if not user:
        check_password_hash(_DUMMY_HASH, password)
        return False
    return check_password_hash(user["password_hash"], password)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_api_token(username: str) -> str:
    """Create a phone/Shortcut token for a user and return its plaintext once."""
    users = load_users()
    token = secrets.token_urlsafe(32)
    users[username].setdefault("token_hashes", []).append(_hash_token(token))
    save_users(users)
    return token


def user_for_token(token: str):
    """Return the username owning an API token, or None."""
    h = _hash_token(token)
    for name, user in load_users().items():
        if any(hmac.compare_digest(h, t) for t in user.get("token_hashes", [])):
            return name
    return None


def set_password(users: dict, username: str, password: str) -> None:
    users[username]["password_hash"] = generate_password_hash(password)
