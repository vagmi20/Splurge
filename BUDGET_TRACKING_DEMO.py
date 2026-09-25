#!/usr/bin/env python3
"""
Test and demonstrate the new Budget Tracking Features

The Finance App now includes advanced budget tracking that shows:
1. How much you've spent in each category (needs/wants/savings)
2. How much budget remains before hitting your limit
3. Visual indicators for budget status
4. Warnings when spending exceeds 80% of allocated budget (wants category)
5. Red indicator when over budget
"""

from datetime import date
from budget_utils import (
    calculate_remaining_budget, 
    CATEGORY_MAPPING,
    map_category_to_budget
)

print("=" * 70)
print("BUDGET TRACKING FEATURES - NEW FUNCTIONALITY")
print("=" * 70)

print("\n📊 CATEGORY MAPPING")
print("-" * 70)
print("Spending categories are automatically mapped to budget categories:")
for budget_cat, spending_cats in CATEGORY_MAPPING.items():
    print(f"\n  {budget_cat.upper()}:")
    for cat in spending_cats:
        print(f"    • {cat}")

print("\n\n💰 EXAMPLE: Monthly Budget with Spending")
print("-" * 70)

monthly_income = 5000
sliders = {'needs': 50, 'wants': 30, 'savings': 20}
today = str(date.today())

spending_records = [
    {'category': 'Food', 'amount': '$450', 'date': today},
    {'category': 'Utilities', 'amount': '$200', 'date': today},
    {'category': 'Entertainment', 'amount': '$450', 'date': today},
    {'category': 'Clothing', 'amount': '$200', 'date': today},
]

print(f"\nMonthly Income: ${monthly_income:,.2f}")
print(f"Budget Allocation: Needs {sliders['needs']}%, Wants {sliders['wants']}%, Savings {sliders['savings']}%")
print(f"\nSpending Today ({today}):")
total_spent = 0
for record in spending_records:
    amount = float(str(record['amount']).replace('$', '').replace(',', ''))
    total_spent += amount
    print(f"  • {record['category']}: {record['amount']}")
print(f"  Total Spent: ${total_spent:,.2f}")

result = calculate_remaining_budget(monthly_income, sliders, spending_records, today)

print("\n" + "-" * 70)
print("BUDGET STATUS:")
print("-" * 70)

for cat, info in result.items():
    allocated = info["allocated"]
    spent = info["spent"]
    remaining = info["remaining"]
    percent_used = info["percent_used"]
    over_budget = info["over_budget"]
    warning = info["warning"]
    
    # Create status line
    status = ""
    if over_budget:
        status = "🔴 OVER BUDGET"
    elif warning:
        status = "🟡 WARNING (80%+ spent)"
    else:
        status = "🟢 ON TRACK"
    
    print(f"\n{cat.upper()} {status}")
    print(f"  Allocated:  ${allocated:8,.2f}")
    print(f"  Spent:      ${spent:8,.2f} ({percent_used:5.1f}%)")
    print(f"  Remaining:  ${remaining:8,.2f}")

print("\n" + "=" * 70)
print("KEY FEATURES:")
print("=" * 70)
print("""
✅ Real-time Budget Tracking
   Shows exactly how much you've spent vs. your budget for each category

✅ Remaining Budget Display
   See how much more you can spend before hitting your limit

✅ Visual Progress Bars
   Color-coded bars show spending progress:
   • Green: On track
   • Yellow: Approaching limit (80%+ for wants)
   • Red: Over budget

✅ Smart Warnings
   • WANTS category shows 80% threshold warning
   • Budget status turns red if you exceed allocated amount
   • Displays overage amount when exceeded

✅ Month-Based Calculations
   • Only current month's spending is tracked
   • Resets monthly for fresh budget tracking
""")

print("\n" + "=" * 70)
