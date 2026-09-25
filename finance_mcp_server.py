#!/usr/bin/env python3
"""
MCP server for the Finance Dashboard.
Exposes tools so Claude Desktop can log expenses directly into a book.

Set FINANCE_USER in the MCP server's env to choose whose personal book it
writes to (optional when there is only one account).
"""

import os
from mcp.server.fastmcp import FastMCP
from auth import load_users
from data_manager import FAMILY_BOOK, book_path, load_data, edit_book, make_id
from datetime import date as _date

mcp = FastMCP("Finance Dashboard")


def _book(book: str) -> str:
    if book == "family":
        return book_path(FAMILY_BOOK)
    user = os.environ.get("FINANCE_USER")
    if not user:
        users = list(load_users())
        if len(users) != 1:
            raise ValueError("Set FINANCE_USER in the MCP server config to pick whose book to use.")
        user = users[0]
    return book_path(user)

VALID_CATEGORIES = [
    "Food", "Gas", "Transit/Parking", "Utilities", "Entertainment",
    "Drinks", "Healthcare", "Clothing", "Other"
]


@mcp.tool()
def add_expense(amount: float, category: str, notes: str = "", date: str = "", book: str = "personal") -> str:
    """
    Add a spending entry to the finance dashboard.

    Args:
        amount: Dollar amount (e.g. 12.50)
        category: One of Food, Gas, Transit/Parking, Utilities, Entertainment, Drinks, Healthcare, Clothing, Other
        notes: Optional description (e.g. 'Chipotle lunch')
        date: Optional date in YYYY-MM-DD format (defaults to today)
        book: "personal" (default) or "family" for shared household spending
    """
    if not date:
        date = str(_date.today())

    cat = category.strip().title()
    with edit_book(_book(book)) as data:
        valid = data.get("spending_categories", VALID_CATEGORIES)
        if cat not in valid:
            return f"Invalid category '{cat}'. Valid options: {', '.join(valid)}"

        entry = {
            "id": make_id(),
            "category": cat,
            "amount": str(round(float(amount), 2)),
            "date": date,
            "notes": notes,
        }
        if book == "family":
            entry["added_by"] = os.environ.get("FINANCE_USER", "claude")
        data["spending"].append(entry)
    return f"Added ${amount:.2f} under {cat} on {date}{' — ' + notes if notes else ''}."


@mcp.tool()
def list_categories(book: str = "personal") -> str:
    """Return the available spending categories for the personal or family book."""
    data = load_data(_book(book))
    cats = data.get("spending_categories", VALID_CATEGORIES)
    return "Available categories: " + ", ".join(cats)


@mcp.tool()
def recent_expenses(n: int = 5, book: str = "personal") -> str:
    """Show the n most recent spending entries in the personal or family book."""
    data = load_data(_book(book))
    entries = data.get("spending", [])[-n:]
    if not entries:
        return "No expenses recorded yet."
    lines = [
        f"${float(e['amount']):.2f}  {e['category']:12}  {e['date']}  {e.get('notes', '')}"
        for e in reversed(entries)
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    mcp.run()
