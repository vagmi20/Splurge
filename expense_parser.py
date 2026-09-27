"""
expense_parser.py
Turns free text like "twelve fifty for lunch at Chipotle" into an expense
using the Claude API.  Only used when ANTHROPIC_API_KEY is set.
"""

import json
import os
import re
from datetime import date as _date

SYSTEM_PROMPT = """You are a finance assistant. Extract expense information from the user's message.
Return ONLY a JSON object with these fields (no markdown, no extra text):
{{
  "amount": <float>,
  "currency": <one of: USD, EUR, INR, DKK — USD unless the message says otherwise (€/euros → EUR, ₹/rupees/Rs → INR, kr/kroner/DKK → DKK)>,
  "category": <one of: {categories}>,
  "notes": <short description, or empty string>,
  "date": <YYYY-MM-DD, use today's date if not specified>
}}
Today's date is {today}."""


def parse_expense_text(text: str, categories: list) -> dict:
    import anthropic

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=256,
        system=SYSTEM_PROMPT.format(categories=", ".join(categories), today=str(_date.today())),
        messages=[{"role": "user", "content": text}],
    )
    raw = msg.content[0].text.strip()
    # Strip any accidental markdown fences
    raw = re.sub(r"^```[a-z]*\n?", "", raw)
    raw = re.sub(r"\n?```$", "", raw)
    return json.loads(raw)
