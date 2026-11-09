"""Fetch all CardSight identification sets and save them as CSV."""

import argparse
import csv
import json
import os
import sys
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_URL = "https://api.cardsight.ai/v1/identify/list/sets"


def fetch_sets(api_key, take=100, skip=0):
    query = urlencode({"take": take, "skip": skip})
    request = Request(
        f"{API_URL}?{query}",
        headers={"Accept": "application/json", "X-API-Key": api_key},
    )

    delay = 2  # Starting delay in seconds
    max_retries = 5

    for attempt in range(max_retries):
        try:
            with urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))

        except HTTPError as e:
            # Check if the error code is 429 (Too Many Requests)
            if e.code == 429 and attempt < max_retries - 1:
                print(f"Rate limited (HTTP 429). Retrying in {delay} seconds...")
                time.sleep(delay)
                delay *= 2  # Double the wait time for the next try
            else:
                # If it's a different HTTP error or we ran out of retries, raise it
                raise e

    raise Exception("Failed to fetch sets after maximum retries due to rate limiting.")
    # with urlopen(request, timeout=30) as response:
    #     return json.loads(response.read().decode("utf-8"))


def extract_sets(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        raise ValueError("CardSight response must be a JSON object or array.")

    for key in ("sets", "data", "items", "results"):
        if isinstance(payload.get(key), list):
            return payload[key]

    list_values = [value for value in payload.values() if isinstance(value, list)]
    if len(list_values) == 1:
        return list_values[0]
    raise ValueError("Could not identify the sets list in the CardSight response.")


def fetch_all_sets(api_key, take=100, skip=0):
    all_sets = []
    current_skip = skip

    while True:
        page = fetch_sets(api_key, take=take, skip=current_skip)
        sets = extract_sets(page)
        all_sets.extend(sets)

        page_skip = page.get("skip", current_skip) if isinstance(page, dict) else current_skip
        page_take = page.get("take", take) if isinstance(page, dict) else take
        total_count = page.get("total_count") if isinstance(page, dict) else None
        next_skip = page_skip + len(sets)

        if not sets or (total_count is not None and next_skip >= total_count):
            break
        if total_count is None and len(sets) < page_take:
            break
        current_skip = next_skip

    return all_sets


def write_csv(sets, output_path):
    fieldnames = list(dict.fromkeys(key for item in sets for key in item))
    with Path(output_path).open("w", newline="", encoding="utf-8") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=fieldnames)
        if fieldnames:
            writer.writeheader()
            for item in sets:
                row = {
                    key: json.dumps(value, ensure_ascii=False)
                    if isinstance(value, (dict, list))
                    else value
                    for key, value in item.items()
                }
                writer.writerow(row)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Fetch CardSight identification sets.")
    parser.add_argument("--take", type=int, default=100)
    parser.add_argument("--skip", type=int, default=0)
    parser.add_argument("--output", default="catalog_sets.csv")
    args = parser.parse_args(argv)
    if args.take <= 0 or args.skip < 0:
        parser.error("--take must be positive and --skip cannot be negative")

    api_key = os.environ.get("CARDSIGHT_API_KEY")
    if not api_key:
        print("Set the CARDSIGHT_API_KEY environment variable first.", file=sys.stderr)
        return 2

    try:
        sets = fetch_all_sets(api_key, take=args.take, skip=args.skip)
        write_csv(sets, args.output)
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

    print(f"Wrote {len(sets)} sets to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())