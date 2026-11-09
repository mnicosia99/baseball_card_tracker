"""Fetch catalog attributes from the CardSight API."""

import argparse
import csv
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_URL = "https://api.cardsight.ai/v1/catalog/attributes"


def fetch_attributes(api_key, take=20, skip=0, short_name="MLB", order="asc"):
    query = urlencode(
        {
            "take": take,
            "skip": skip,
            "shortName": short_name,
            "order": order,
        }
    )
    request = Request(
        f"{API_URL}?{query}",
        headers={"Accept": "application/json", "X-API-Key": api_key},
    )

    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def extract_items(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        raise ValueError("CardSight response must be a JSON object or array.")

    for key in ("data", "items", "results", "attributes"):
        if isinstance(payload.get(key), list):
            return payload[key]

    list_values = [value for value in payload.values() if isinstance(value, list)]
    if len(list_values) == 1:
        return list_values[0]
    raise ValueError("Could not identify the results list in the CardSight response.")


def fetch_all_attributes(api_key, take=20, skip=0, short_name="MLB", order="asc"):
    all_items = []
    current_skip = skip

    while True:
        page = fetch_attributes(
            api_key,
            take=take,
            skip=current_skip,
            short_name=short_name,
            order=order,
        )
        items = extract_items(page)
        all_items.extend(items)

        page_skip = page.get("skip", current_skip) if isinstance(page, dict) else current_skip
        page_take = page.get("take", take) if isinstance(page, dict) else take
        total_count = page.get("total_count") if isinstance(page, dict) else None
        next_skip = page_skip + len(items)

        if not items or (total_count is not None and next_skip >= total_count):
            break
        if total_count is None and len(items) < page_take:
            break
        current_skip = next_skip

    return all_items


def write_csv(items, output_path):
    fieldnames = list(dict.fromkeys(key for item in items for key in item))
    with Path(output_path).open("w", newline="", encoding="utf-8") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=fieldnames)
        if fieldnames:
            writer.writeheader()
            for item in items:
                row = {
                    key: json.dumps(value, ensure_ascii=False)
                    if isinstance(value, (dict, list))
                    else value
                    for key, value in item.items()
                }
                writer.writerow(row)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Fetch CardSight catalog attributes.")
    parser.add_argument("--take", type=int, default=20)
    parser.add_argument("--skip", type=int, default=0)
    parser.add_argument("--short-name", default="MLB")
    parser.add_argument("--order", choices=("asc", "desc"), default="asc")
    parser.add_argument("--output", default="catalog_attributes.csv")
    args = parser.parse_args(argv)
    if args.take <= 0 or args.skip < 0:
        parser.error("--take must be positive and --skip cannot be negative")

    api_key = os.environ.get("CARDSIGHT_API_KEY")
    if not api_key:
        print("Set the CARDSIGHT_API_KEY environment variable first.", file=sys.stderr)
        return 2

    try:
        items = fetch_all_attributes(
            api_key,
            take=args.take,
            skip=args.skip,
            short_name=args.short_name,
            order=args.order,
        )
        write_csv(items, args.output)
    except HTTPError as error:
        print(f"CardSight returned HTTP {error.code}: {error.reason}", file=sys.stderr)
        return 1
    except URLError as error:
        print(f"Could not reach CardSight: {error.reason}", file=sys.stderr)
        return 1
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        print(f"CardSight returned invalid JSON: {error}", file=sys.stderr)
        return 1
    except (OSError, ValueError) as error:
        print(f"Could not save CardSight results: {error}", file=sys.stderr)
        return 1

    print(f"Wrote {len(items)} attributes to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())