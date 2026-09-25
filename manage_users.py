#!/usr/bin/env python3
"""
Manage family accounts for the Finance Dashboard.

  python manage_users.py add <username> [--name "Display Name"] [--hint "..."] [--import old.json]
  python manage_users.py passwd <username>
  python manage_users.py hint <username> ["new hint"]   # omit the text to remove it
  python manage_users.py token <username>        # new token for the iOS Shortcut
  python manage_users.py revoke-tokens <username>
  python manage_users.py list

`--import` copies an existing finance_data.json in as that person's personal book.
"""

import argparse
import getpass
import json
import os
import sys

from auth import RESERVED_USERNAMES, USERNAME_RE, load_users, new_api_token, save_users, set_password
from data_manager import book_path, load_data, save_data


def _prompt_password() -> str:
    while True:
        pw = getpass.getpass("Password: ")
        if len(pw) < 8:
            print("Use at least 8 characters.")
            continue
        if pw != getpass.getpass("Confirm:  "):
            print("Passwords don't match.")
            continue
        return pw


def _require_user(users, username):
    if username not in users:
        sys.exit(f"No user named '{username}'. Run `list` to see accounts.")


def cmd_add(args):
    users = load_users()
    username = args.username.lower()
    if not USERNAME_RE.match(username):
        sys.exit("Usernames are 2-32 chars of a-z, 0-9, '_' or '-'.")
    if username in RESERVED_USERNAMES:
        sys.exit(f"'{username}' is reserved: the Family book is already shared by every account.")
    if username in users:
        sys.exit(f"'{username}' already exists.")

    path = book_path(username)
    if args.import_file:
        if os.path.exists(path):
            sys.exit(f"{path} already exists; refusing to overwrite it.")
        with open(args.import_file) as f:
            json.load(f)  # fail early on a bad file
        save_data(load_data(args.import_file), path)
        print(f"Imported {args.import_file} → {path}")

    users[username] = {"display_name": args.name or username.title(), "token_hashes": []}
    if args.hint:
        users[username]["hint"] = args.hint
    set_password(users, username, _prompt_password())
    save_users(users)
    print(f"Added {username}.")


def cmd_passwd(args):
    users = load_users()
    _require_user(users, args.username)
    set_password(users, args.username, _prompt_password())
    save_users(users)
    print("Password updated.")


def cmd_hint(args):
    users = load_users()
    _require_user(users, args.username)
    if args.text:
        users[args.username]["hint"] = args.text
    else:
        users[args.username].pop("hint", None)
    save_users(users)
    print("Hint updated." if args.text else "Hint removed.")


def cmd_token(args):
    _require_user(load_users(), args.username)
    token = new_api_token(args.username)
    print("New API token (shown once — paste it into the iOS Shortcut):\n")
    print(f"  {token}\n")


def cmd_revoke(args):
    users = load_users()
    _require_user(users, args.username)
    users[args.username]["token_hashes"] = []
    save_users(users)
    print("All API tokens revoked.")


def cmd_list(_args):
    users = load_users()
    if not users:
        print("No accounts yet. Add one with: python manage_users.py add <username>")
    for name, u in users.items():
        hint = "hint set" if u.get("hint") else "no hint"
        print(f"{name:16} {u.get('display_name', ''):20} {hint:10} {len(u.get('token_hashes', []))} token(s)")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("add")
    a.add_argument("username")
    a.add_argument("--name", help="display name shown in the app")
    a.add_argument("--hint", help="password hint shown on the login page under 'Forgot password?'")
    a.add_argument("--import", dest="import_file", help="existing finance_data.json to use as this person's book")
    a.set_defaults(fn=cmd_add)

    for name, fn in [("passwd", cmd_passwd), ("token", cmd_token), ("revoke-tokens", cmd_revoke)]:
        s = sub.add_parser(name)
        s.add_argument("username")
        s.set_defaults(fn=fn)

    h = sub.add_parser("hint")
    h.add_argument("username")
    h.add_argument("text", nargs="?", help="omit to remove the hint")
    h.set_defaults(fn=cmd_hint)

    sub.add_parser("list").set_defaults(fn=cmd_list)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
