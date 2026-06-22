#!/usr/bin/env python3
"""Generate books.json from the per-book folders under books/.

Each book lives in books/<slug>/ and contains its files plus an info.txt:

    books/<slug>/
      <name>-Light.pdf
      <name>-Dark.pdf
      <name>-Cover.jpg        (or .png/.webp/...)
      info.txt                ("key: value" per line)

Folders without a usable info.txt (or with no title) are skipped with a
warning; the rest are still built. Output is sorted by slug for clean diffs.

Usage: build_books.py [books_dir] [output_file]
       defaults: books_dir=books  output_file=books.json
"""
import json
import os
import sys

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")

# Normalize Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII for numeric fields.
_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def parse_info(path):
    """Read an info.txt of 'key: value' lines into a dict (keys lowercased)."""
    data = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if ":" not in line or not line.strip():
                continue
            key, _, value = line.partition(":")
            data[key.strip().lower()] = value.strip()
    return data


def split_tags(raw):
    """Split on Persian '،' or English ',', trim, drop empties -> list."""
    if not raw:
        return []
    parts = raw.replace("،", ",").split(",")
    return [t.strip() for t in parts if t.strip()]


def as_number(raw):
    """Return an int when the value is numeric (Persian digits ok), else the
    original string. Empty stays an empty string."""
    if not raw:
        return ""
    try:
        return int(raw.translate(_DIGITS).strip())
    except ValueError:
        return raw


def find_file(files, predicate):
    for name in files:
        if predicate(name.lower()):
            return name
    return ""


def build_book(slug, dirpath):
    info_path = os.path.join(dirpath, "info.txt")
    if not os.path.isfile(info_path):
        raise ValueError("info.txt missing")
    info = parse_info(info_path)
    title = info.get("title", "").strip()
    if not title:
        raise ValueError("title missing in info.txt")

    files = [f for f in os.listdir(dirpath) if os.path.isfile(os.path.join(dirpath, f))]

    # Field order matches the rest of books.json for a stable, readable diff.
    return {
        "slug": slug,
        "title": title,
        "author": info.get("author", ""),
        "year": as_number(info.get("year", "")),
        "language": info.get("language", "").strip() or "فارسی",
        "category": info.get("category", ""),
        "tags": split_tags(info.get("tags", "")),
        "pages": as_number(info.get("pages", "")),
        "description": info.get("description", ""),
        "file_light": find_file(files, lambda n: n.endswith("-light.pdf")),
        "file_dark": find_file(files, lambda n: n.endswith("-dark.pdf")),
        "cover": find_file(files, lambda n: "-cover" in n and n.endswith(IMAGE_EXTS)),
    }


def main():
    books_dir = sys.argv[1] if len(sys.argv) > 1 else "books"
    out_file = sys.argv[2] if len(sys.argv) > 2 else "books.json"

    if not os.path.isdir(books_dir):
        print(f"::error::books directory not found: {books_dir}")
        sys.exit(1)

    books = []
    for slug in sorted(os.listdir(books_dir)):
        dirpath = os.path.join(books_dir, slug)
        if not os.path.isdir(dirpath):
            continue
        try:
            books.append(build_book(slug, dirpath))
        except Exception as exc:  # incomplete folder: skip it, keep going
            print(f"::warning::skipping '{slug}': {exc}")

    books.sort(key=lambda b: b["slug"])

    with open(out_file, "w", encoding="utf-8") as fh:
        json.dump(books, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(f"Wrote {len(books)} book(s) to {out_file}")


if __name__ == "__main__":
    main()
