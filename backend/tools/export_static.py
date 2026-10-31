"""Writes frontend/src/data/static.json: the bank list and category names, so the website can show them without waking
Python. Run after changing core/banks.py or the categories:   python backend/tools/export_static.py
(tests/test_banks.py fails if the file is out of date.)"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from core import banks, categorizer  # noqa: E402

PATH = os.path.join(os.path.dirname(os.path.dirname(HERE)), "frontend", "src", "data", "static.json")


def build() -> dict:
    return {"banks": banks.public_list(), "categories": categorizer.CATEGORIES}


if __name__ == "__main__":
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(build(), f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("wrote", PATH)
