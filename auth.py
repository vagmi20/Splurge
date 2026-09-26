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

# PBKDF2 rather than werkzeug's default scrypt: Apple's built-in Python lacks
# scrypt, and this keeps data/users.json portable between any two machines.
HASH_METHOD = "pbkdf2:sha256:600000"

# Used to spend the same time on unknown usernames as on wrong passwords.
_DUMMY_HASH = generate_password_hash("not-a-real-password", method=HASH_METHOD)


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


MIN_PASSWORD_LENGTH = 8


def new_username_error(username: str, users: dict):
    """Why `username` can't be used for a new account, or None if it can."""
    if not USERNAME_RE.match(username):
        return "Usernames are 2-32 chars of a-z, 0-9, '_' or '-'."
    if username in RESERVED_USERNAMES:
        return f"'{username}' is reserved: the Family book is already shared by every account."
    if username in users:
        return f"'{username}' already exists."
    return None


def create_user(username: str, password: str, display_name: str = "", hint: str = "") -> None:
    """Add an account. Raises ValueError with a user-facing message if it can't."""
    users = load_users()
    error = new_username_error(username, users)
    if error:
        raise ValueError(error)
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Use at least {MIN_PASSWORD_LENGTH} characters for the password.")
    users[username] = {"display_name": display_name or username.title(), "token_hashes": []}
    if hint:
        users[username]["hint"] = hint
    set_password(users, username, password)
    save_users(users)


def set_password(users: dict, username: str, password: str) -> None:
    users[username]["password_hash"] = generate_password_hash(password, method=HASH_METHOD)
