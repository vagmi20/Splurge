"""
budget_utils.py
Pure budget calculation helpers for the Finance Dashboard.

Key design decisions
─────────────────────
• Dollar amounts are computed from the *actual* paycheck income, not a
  hardcoded figure.
• Sliders for Needs / Wants / Savings no longer need to sum to 100%.
  Any remainder below 100% is surfaced as an explicit "Unallocated" bucket.
• All public functions are stateless: they accept plain numbers and return
  plain numbers/dicts so they are easy to unit-test independently.
"""

from __future__ import annotations
from typing import Dict
from datetime import datetime, date as date_cls
from data_manager import parse_amount


# ── Paycheck helpers ──────────────────────────────────────────────────────────

FREQUENCY_MULTIPLIERS: Dict[str, float] = {
    "weekly":      52 / 12,
    "biweekly":    26 / 12,
    "semimonthly": 2.0,
    "monthly":     1.0,
    "quarterly":   1 / 3,
    "annually":    1 / 12,
}


def paycheck_monthly(paycheck: dict) -> float:
    """Return the monthly equivalent of a single paycheck record."""
    freq = paycheck.get("frequency", "monthly")
    amt  = parse_amount(paycheck.get("amount", 0))
    return amt * FREQUENCY_MULTIPLIERS.get(freq, 1.0)


def total_monthly_income(paychecks: list) -> float:
    """Sum monthly equivalents across all paycheck records."""
    return sum(paycheck_monthly(p) for p in paychecks)


# ── Budget allocation helpers ─────────────────────────────────────────────────

def compute_budget_allocation(monthly_income: float, sliders: dict) -> dict:
    """
    Given a monthly income and a slider dict like:
        {"needs": 50, "wants": 30, "savings": 20}
    return a full allocation breakdown including any unallocated remainder.

    Return value
    ────────────
    {
        "needs":       {"pct": 50, "amount": 2500.00},
        "wants":       {"pct": 30, "amount": 1500.00},
        "savings":     {"pct": 20, "amount": 1000.00},
        "unallocated": {"pct":  0, "amount":    0.00},   # when pcts sum to 100
        "total_pct":   100,
    }

    If the three sliders sum to, say, 80%, the remaining 20% appears in
    "unallocated" so nothing is ever silently lost.
    """
    needs_pct   = int(sliders.get("needs",   0))
    wants_pct   = int(sliders.get("wants",   0))
    savings_pct = int(sliders.get("savings", 0))

    allocated_pct   = needs_pct + wants_pct + savings_pct
    # Cap at 100 so we never show a negative unallocated bucket
    unallocated_pct = max(0, 100 - allocated_pct)

    def _dollars(pct: int) -> float:
        return round(monthly_income * pct / 100, 2)

    return {
        "needs":       {"pct": needs_pct,       "amount": _dollars(needs_pct)},
        "wants":       {"pct": wants_pct,        "amount": _dollars(wants_pct)},
        "savings":     {"pct": savings_pct,      "amount": _dollars(savings_pct)},
        "unallocated": {"pct": unallocated_pct,  "amount": _dollars(unallocated_pct)},
        "total_pct":   allocated_pct,
    }


def slider_total(sliders: dict) -> int:
    """Return the sum of the three slider values."""
    return (
        int(sliders.get("needs",   0))
        + int(sliders.get("wants",  0))
        + int(sliders.get("savings", 0))
    )


def slider_status(sliders: dict) -> tuple[str, str]:
    """
    Return (status_text, color_key) for the slider total indicator.
        "ok"      → total == 100 (fully allocated, nothing wasted)
        "under"   → total <  100 (some income unallocated)
        "over"    → total >  100 (over-allocated, impossible to fulfill)
    """
    total = slider_total(sliders)
    if total == 100:
        return f"Total: {total}%  ✓ Fully allocated", "accent2"
    elif total < 100:
        leftover = 100 - total
        return f"Total: {total}%  ({leftover}% unallocated)", "accent4"
    else:
        over = total - 100
        return f"Total: {total}%  ⚠ Over by {over}%", "accent3"


# ── Spending category mapping ─────────────────────────────────────────────────

CATEGORY_MAPPING = {
    "needs": ["Gas", "Transit/Parking", "Utilities", "Healthcare", "Car Services"],
    "wants": ["Food", "Alcohol", "Entertainment", "Clothing", "Drinks","Other"],
    "savings": [],  # Explicit savings are tracked separately
}


def map_category_to_budget(spending_category: str) -> str:
    """
    Map a spending category to its budget category (needs/wants/savings).
    Returns "wants" as default for unmapped categories.
    """
    for budget_cat, spending_cats in CATEGORY_MAPPING.items():
        if spending_category in spending_cats:
            return budget_cat
    return "wants"  # Default to wants if not found


def map_subscription_to_budget(subscription_category: str) -> str:
    """
    Map a subscription category to its budget category.
    Gym is a need (health), everything else is wants.
    """
    if subscription_category == "Gym":
        return "needs"
    return "wants"  # All other subscriptions are wants


def spending_by_budget_category(spending_records: list) -> dict:
    """
    Group spending records by budget category (needs/wants).
    Returns dict like: {"needs": 500.00, "wants": 150.00}
    """
    totals = {"needs": 0.0, "wants": 0.0}
    for record in spending_records:
        cat = record.get("category", "Other")
        amt = parse_amount(record.get("amount", 0))
        budget_cat = map_category_to_budget(cat)
        if budget_cat in totals:
            totals[budget_cat] += amt
    return totals


def calculate_remaining_budget(
    monthly_income: float,
    sliders: dict,
    spending_records: list,
    current_date: str = None,
    monthly_investments: float = 0.0,
    subscriptions: list = None
) -> dict:
    """
    Calculate remaining budget for each category based on actual spending.
    
    Returns dict like:
    {
        "needs": {
            "allocated": 2000.00,
            "spent": 1500.00,
            "remaining": 500.00,
            "percent_used": 75.0,
            "warning": False
        },
        "wants": {...},
        "savings": {...}
    }
    """
    # Calculate allocated amounts
    allocation = compute_budget_allocation(monthly_income, sliders)
    
    # Get spending for this month only
    today = current_date or date_cls.today().isoformat()
    try:
        today_dt = datetime.strptime(today if isinstance(today, str) else str(today), "%Y-%m-%d")
        current_month = today_dt.month
        current_year = today_dt.year
    except:
        current_month = date_cls.today().month
        current_year = date_cls.today().year
    
    this_month_spending = [
        s for s in spending_records
        if s.get("category") and _is_this_month(s.get("date", ""), current_month, current_year)
    ]
    
    spending = spending_by_budget_category(this_month_spending)
    
    # Include monthly investment contributions as part of savings spending
    spending["savings"] = spending.get("savings", 0) + monthly_investments
    
    # Include active subscriptions in the appropriate budget categories
    if subscriptions:
        for sub in subscriptions:
            if sub.get("active", True):
                cat = map_subscription_to_budget(sub.get("category", "Other"))
                spending[cat] = spending.get(cat, 0) + parse_amount(sub.get("amount", 0))
    
    result = {}
    for cat in ["needs", "wants", "savings"]:
        allocated = allocation[cat]["amount"]
        spent = spending.get(cat, 0.0)
        remaining = allocated - spent
        percent_used = (spent / allocated * 100) if allocated > 0 else 0
        
        result[cat] = {
            "allocated": round(allocated, 2),
            "spent": round(spent, 2),
            "remaining": round(remaining, 2),
            "percent_used": round(percent_used, 1),
            "over_budget": spent > allocated,
            "warning": cat == "wants" and percent_used > 80,  # 80% warning for wants
        }
    
    return result


def _is_this_month(date_str: str, month: int, year: int) -> bool:
    """Check if a date string is in the given month/year."""
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d")
        return d.month == month and d.year == year
    except:
        return False
