#!/usr/bin/env python3
"""Quick test for parse_amount function"""
from data_manager import parse_amount

test_cases = [
    ("$2847.37", 2847.37),
    ("$1,000", 1000.0),
    ("100", 100.0),
    ("$0", 0.0),
    ("  $5,000.50  ", 5000.50),
]

print("Testing parse_amount function:")
print("-" * 50)
for input_val, expected in test_cases:
    result = parse_amount(input_val)
    status = "✓" if result == expected else "✗"
    print(f"{status} parse_amount({input_val!r}) = {result} (expected {expected})")
