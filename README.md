# Family Finance Dashboard

A self-hosted finance dashboard for a household. Everyone signs in with their own account and can
switch between two **books**:

- **Personal**: their own paychecks, investments, spending, subscriptions, goals, and vacations. Only they can see it.
- **Family**: one shared book for household spending, joint investments, and shared goals. Every signed-in family member can see and edit it, and each shared expense records who added it.

Everything runs on one machine (the "host"). Family members reach it over Tailscale.

## Where the data lives

All private data lives in `data/`, and the whole folder is git-ignored:

```
data/users.json          accounts (salted password hashes, phone-token hashes)
data/users/<name>.json   each person's personal book
data/family.json         the shared family book
data/secret_key          signs login cookies (auto-generated)
```

**Nothing in `data/` goes to GitHub, so back it up yourself** (Time Machine, an encrypted disk image, etc.).
When you move to a new machine, copy `data/` over along with the code.

## Setup on the host

```bash
git clone <your-repo> Finance_Project && cd Finance_Project
python3 -m venv venv
venv/bin/pip install -r requirements.txt
cp .env.example .env            # optional: add ANTHROPIC_API_KEY
```

Create an account for each family member. Passwords are prompted and never echoed.
`--hint` is optional; it's shown on the login page under "Forgot password?":

```bash
venv/bin/python manage_users.py add alex --name "Alex" --hint "first pet + birth year"
venv/bin/python manage_users.py add sam  --name "Sam"
```

There's no separate "family" account. Every login already has access to the shared Family book,
and keeping one login per person means shared expenses show who added them.

Anyone on your tailnet can read a hint by typing that username, so make hints meaningful only to that person.

**Migrating from the single-user version:** bring your old `finance_data.json` over as your personal book:

```bash
venv/bin/python manage_users.py add <you> --import finance_data.json
```

Run it:

```bash
venv/bin/python web_app.py      # http://localhost:5050
```

Other commands: `manage_users.py passwd <user>` (reset a forgotten password), `manage_users.py hint <user> ["text"]`, `manage_users.py list`.

## Reaching it from phones (Tailscale)

The server listens on `127.0.0.1` only. Use `tailscale serve` to publish it to your tailnet over HTTPS.
It is reachable only by devices signed into your tailnet, never the public internet:

```bash
tailscale serve --bg 5050
tailscale serve status          # shows https://<host>.<tailnet>.ts.net
```

On each phone, with Tailscale connected:

1. Open `https://<host>.<tailnet>.ts.net/quick` in Safari and sign in once (the session lasts 30 days).
2. Tap Share, then **Add to Home Screen**. You now have a one-tap "Log Expense" app with a Personal/Family toggle.

The full dashboard is at the same address without `/quick`. It's built for desktop screens.

To share with family members who have their own Tailscale accounts, invite them to your tailnet or
[share the host machine](https://tailscale.com/kb/1084/sharing) with them.

> Keep the host awake and the server running. A LaunchAgent works well for this, or just leave it running in a terminal.

### Optional: iOS Shortcut ("Hey Siri, log expense")

Create a token for the person (it's shown once):

```bash
venv/bin/python manage_users.py token <user>
```

In the Shortcuts app:

1. **Ask for Input** (Number): "Amount?"
2. **Choose from Menu**: Food / Gas / … (or **Dictate Text** and send `text` instead, see below)
3. **Get Contents of URL**
   - URL: `https://<host>.<tailnet>.ts.net/api/quick-add`
   - Method: `POST`
   - Headers: `Authorization: Bearer <token>`
   - Request Body (JSON): `amount` = Provided Input, `category` = Chosen Item, `book` = `personal` or `family`
4. **Get Dictionary Value** `message`, then **Show Notification**.

With `ANTHROPIC_API_KEY` set on the host, you can send `{"text": "twelve fifty for lunch at Chipotle", "book": "family"}`
from a **Dictate Text** action instead, and Claude fills in the amount, category, and notes.

Revoke tokens with `manage_users.py revoke-tokens <user>`.

## Claude Desktop (MCP)

`finance_mcp_server.py` lets Claude Desktop log expenses with the `add_expense`, `recent_expenses`, and `list_categories` tools.
Each tool takes `book: "personal" | "family"`. If more than one account exists, set `FINANCE_USER` in the server's
`env` block in `claude_desktop_config.json`.

## Files

| File | Purpose |
|------|---------|
| `web_app.py` | Flask app: dashboard, login, `/quick` phone page, `/api/quick-add` |
| `auth.py` / `manage_users.py` | Accounts, password/token hashing, and the CLI to manage them |
| `data_manager.py` | Loading/saving books (file-locked, atomic writes), Excel import/export |
| `receipt_parser.py` | On-device receipt OCR (macOS Vision) for bill splitting |
| `expense_parser.py` | Optional Claude parsing of free-text expenses |
| `finance_mcp_server.py` | MCP server for Claude Desktop |
| `finance_app.py` | Legacy single-user desktop (Tk) app. It still reads a root-level `finance_data.json` |
