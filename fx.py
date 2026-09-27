"""
fx.py
Currency conversion for logging expenses in other currencies.

Rates are the European Central Bank reference rates, fetched from the free
Frankfurter API (https://frankfurter.dev, no API key). They're published
once per working day, so the rate used for an expense is the one from its
date (or the last working day before it). Future dates use the latest rate.

Rates are cached in data/fx_cache.json, so conversions keep working (with
the last known rate) if the host is offline.
"""

import json
import os
import threading
import urllib.request
from datetime import date as _date, datetime, timedelta

from data_manager import DATA_DIR

BASE = "USD"   # every book stores amounts in this currency
CURRENCIES = {
    "USD": {"symbol": "$",  "name": "US Dollar"},
    "EUR": {"symbol": "€",  "name": "Euro"},
    "INR": {"symbol": "₹",  "name": "Indian Rupee"},
    "DKK": {"symbol": "kr", "name": "Danish Krone"},
}

API = "https://api.frankfurter.dev/v1"
CACHE_PATH = os.path.join(DATA_DIR, "fx_cache.json")
LATEST_TTL = timedelta(hours=6)

_lock = threading.Lock()


def _load_cache() -> dict:
    try:
        with open(CACHE_PATH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_cache(cache: dict) -> None:
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    tmp = CACHE_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cache, f)
    os.replace(tmp, CACHE_PATH)


def _fetch(day: str) -> dict:
    """{"date": ..., "rates": {CUR: units of CUR per 1 USD}} from Frankfurter."""
    others = ",".join(c for c in CURRENCIES if c != BASE)
    url = f"{API}/{day}?base={BASE}&symbols={others}"
    req = urllib.request.Request(url, headers={"User-Agent": "family-finance-dashboard"})
    with urllib.request.urlopen(req, timeout=8) as r:
        data = json.load(r)
    return {"date": data["date"], "rates": {**data["rates"], BASE: 1.0}}


def rates_for(day=None) -> dict:
    """
    Rates for a date ("YYYY-MM-DD"), or the latest when day is None or in the future.
    Returns {"date": rate date, "rates": {CUR: per 1 USD}, "stale": bool}.
    Raises RuntimeError if the rates can't be fetched and nothing is cached.
    """
    today = str(_date.today())
    if not day or day >= today:
        key = "latest"
    else:
        key = day

    with _lock:
        cache = _load_cache()
        hit = cache.get(key)
        fresh = hit and (key != "latest" or
                         datetime.now() - datetime.fromisoformat(hit["fetched"]) < LATEST_TTL)
        if fresh and all(c in hit["rates"] for c in CURRENCIES):
            return {"date": hit["date"], "rates": hit["rates"], "stale": False}
        try:
            got = _fetch(key)
        except Exception as e:
            # Offline or API down: fall back to the closest thing we have
            fallback = hit or cache.get("latest")
            if fallback:
                return {"date": fallback["date"], "rates": fallback["rates"], "stale": True}
            raise RuntimeError(f"Couldn't fetch exchange rates ({e})") from e
        cache[key] = {**got, "fetched": datetime.now().isoformat(timespec="seconds")}
        _save_cache(cache)
        return {**got, "stale": False}


def to_base(amount: float, currency: str, day=None) -> dict:
    """
    Convert an amount in `currency` to USD using the rate for `day`.
    Returns {"amount": USD amount, "rate": USD per 1 unit of currency, "rate_date": ...}.
    """
    currency = (currency or BASE).upper()
    if currency not in CURRENCIES:
        raise ValueError(f"Unsupported currency {currency}; use one of {', '.join(CURRENCIES)}")
    if currency == BASE:
        return {"amount": round(amount, 2), "rate": 1.0, "rate_date": day}
    r = rates_for(day)
    rate = 1.0 / r["rates"][currency]
    return {"amount": round(amount * rate, 2), "rate": round(rate, 6), "rate_date": r["date"]}


def fmt(amount: float, currency: str) -> str:
    sym = CURRENCIES.get(currency, {}).get("symbol", currency + " ")
    return f"{amount:,.2f} {sym}" if currency == "DKK" else f"{sym}{amount:,.2f}"
