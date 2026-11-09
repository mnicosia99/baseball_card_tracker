"""Fetch all CardSight catalog releases and save them as CSV."""

import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_URL = "https://api.cardsight.ai/v1/catalog/releases"
SEGMENT_ID = "671e78da-64d2-45a4-8082-6682b2ae0e19"


def fetch_releases(api_key, take=100, skip=0, order="asc"):
    query = urlencode({"take": take, "skip": skip, "order": order})
    request = Request(
        f"{API_URL}?{query}",
        headers={"Accept": "application/json", "X-API-Key": api_key},
    )

    delay = 2
    max_retries = 5
    for attempt in range(max_retries):
        try:
            with urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            if error.code == 429 and attempt < max_retries - 1:
                print(f"Rate limited (HTTP 429). Retrying in {delay} seconds...", file=sys.stderr)
                time.sleep(delay)
                delay *= 2
            else:
                raise

    raise RuntimeError("Failed to fetch releases after rate-limit retries.")


def extract_releases(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        raise ValueError("CardSight response must be a JSON object or array.")

    for key in ("releases", "data", "items", "results"):
        if isinstance(payload.get(key), list):
            return payload[key]

    list_values = [value for value in payload.values() if isinstance(value, list)]
    if len(list_values) == 1:
        return list_values[0]
    raise ValueError("Could not identify the releases list in the CardSight response.")


def fetch_all_releases(api_key, take=100, skip=0, order="asc"):
    all_releases = []
    current_skip = skip

    while True:
        page = fetch_releases(api_key, take=take, skip=current_skip, order=order)
        releases = extract_releases(page)
        all_releases.extend(releases)

        page_skip = page.get("skip", current_skip) if isinstance(page, dict) else current_skip
        page_take = page.get("take", take) if isinstance(page, dict) else take
        total_count = page.get("total_count") if isinstance(page, dict) else None
        next_skip = page_skip + len(releases)

        if not releases or (total_count is not None and next_skip >= total_count):
            break
        if total_count is None and len(releases) < page_take:
            break
        current_skip = next_skip

    return all_releases


def write_csv(releases, output_path):
    fieldnames = list(dict.fromkeys(key for item in releases for key in item))
    with Path(output_path).open("w", newline="", encoding="utf-8") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=fieldnames)
        if fieldnames:
            writer.writeheader()
            for item in releases:
                row = {
                    key: json.dumps(value, ensure_ascii=False)
                    if isinstance(value, (dict, list))
                    else value
                    for key, value in item.items()
                }
                writer.writerow(row)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Fetch CardSight catalog releases.")
    parser.add_argument("--take", type=int, default=100)
    parser.add_argument("--skip", type=int, default=0)
    parser.add_argument("--order", choices=("asc", "desc"), default="asc")
    parser.add_argument("--output", default="catalog_releases.csv")
    args = parser.parse_args(argv)
    if args.take <= 0 or args.skip < 0:
        parser.error("--take must be positive and --skip cannot be negative")

    api_key = os.environ.get("CARDSIGHT_API_KEY")
    if not api_key:
        print("Set the CARDSIGHT_API_KEY environment variable first.", file=sys.stderr)
        return 2

    try:
        releases = fetch_all_releases(
            api_key,
            take=args.take,
            skip=args.skip,
            order=args.order,
        )
        releases = [release for release in releases if release.get("segmentId") == SEGMENT_ID]
        write_csv(releases, args.output)
    except HTTPError as error:
        print(f"CardSight returned HTTP {error.code}: {error.reason}", file=sys.stderr)
        return 1
    except URLError as error:
        print(f"Could not reach CardSight: {error.reason}", file=sys.stderr)
        return 1
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        print(f"CardSight returned invalid JSON: {error}", file=sys.stderr)
        return 1
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Could not save CardSight results: {error}", file=sys.stderr)
        return 1

    print(f"Wrote {len(releases)} releases to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())