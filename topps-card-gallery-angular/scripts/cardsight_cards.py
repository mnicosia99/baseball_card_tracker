"""Load CardSight cards for a release into a CSV file."""

import csv
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_URL = "https://api.cardsight.ai/v1/catalog/cards"
CARD_COLUMNS = (
    "releaseId",
    "setId",
    "id",
    "number",
    "name",
    "description",
    "setName",
    "releaseName",
    "releaseYear",
    "attributes",
    "variationOf",
    "variations",
)


def fetch_cards(api_key, release_id, take=100, skip=0, order="asc"):
    query = urlencode(
        {
            "take": take,
            "skip": skip,
            "releaseId": release_id,
            "order": order,
        }
    )
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

    raise RuntimeError("Failed to fetch cards after rate-limit retries.")


def extract_cards(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        raise ValueError("CardSight response must be a JSON object or array.")

    for key in ("cards", "data", "items", "results"):
        if isinstance(payload.get(key), list):
            return payload[key]

    list_values = [value for value in payload.values() if isinstance(value, list)]
    if len(list_values) == 1:
        return list_values[0]
    raise ValueError("Could not identify the cards list in the CardSight response.")


def fetch_all_cards(api_key, release_id, take=100, skip=0, order="asc"):
    all_cards = []
    current_skip = skip

    while True:
        page = fetch_cards(
            api_key,
            release_id,
            take=take,
            skip=current_skip,
            order=order,
        )
        cards = extract_cards(page)
        all_cards.extend(cards)

        page_skip = page.get("skip", current_skip) if isinstance(page, dict) else current_skip
        page_take = page.get("take", take) if isinstance(page, dict) else take
        total_count = page.get("total_count") if isinstance(page, dict) else None
        next_skip = page_skip + len(cards)

        if not cards or (total_count is not None and next_skip >= total_count):
            break
        if total_count is None and len(cards) < page_take:
            break
        current_skip = next_skip

    return all_cards


def write_cards_csv(cards, output_path="cardsight_cards.csv", force_recreate=False):
    path = Path(output_path)
    file_exists = path.exists()
    existing_rows = []
    existing_columns = []
    if file_exists and not force_recreate:
        with path.open(newline="", encoding="utf-8") as existing_file:
            reader = csv.DictReader(existing_file)
            existing_columns = reader.fieldnames or []
            existing_rows = list(reader)

    card_columns = [key for card in cards for key in card]
    fieldnames = list(dict.fromkeys([*existing_columns, *CARD_COLUMNS, *card_columns]))
    needs_migration = file_exists and not force_recreate and fieldnames != existing_columns
    rewrite_file = force_recreate or not file_exists or needs_migration

    def write_rows(output_file, rows):
        writer = csv.DictWriter(output_file, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            normalized = {
                key: json.dumps(value, ensure_ascii=False)
                if isinstance(value, (dict, list))
                else value
                for key, value in row.items()
            }
            writer.writerow(normalized)

    if needs_migration:
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(
                "w", newline="", encoding="utf-8", dir=path.parent, delete=False
            ) as output_file:
                temp_path = Path(output_file.name)
                write_rows(output_file, [*existing_rows, *cards])
            os.replace(temp_path, path)
        finally:
            if temp_path is not None and temp_path.exists():
                temp_path.unlink()
    elif rewrite_file:
        with path.open("w", newline="", encoding="utf-8") as output_file:
            write_rows(output_file, cards)
    else:
        with path.open("a", newline="", encoding="utf-8") as output_file:
            writer = csv.DictWriter(output_file, fieldnames=fieldnames)
            for card in cards:
                normalized = {
                    key: json.dumps(value, ensure_ascii=False)
                    if isinstance(value, (dict, list))
                    else value
                    for key, value in card.items()
                }
                writer.writerow(normalized)


def load_cards(
    release_id,
    api_key=None,
    output_path="cardsight_cards.csv",
    force_recreate=False,
    take=100,
    skip=0,
    order="asc",
):
    """Fetch all cards for a release and append them to a CSV.

    The existing CSV is preserved by default. Set ``force_recreate=True`` to
    replace it after the API request completes successfully.
    """
    if not release_id:
        raise ValueError("release_id is required.")
    if take <= 0 or skip < 0:
        raise ValueError("take must be positive and skip cannot be negative.")

    resolved_api_key = api_key or os.environ.get("CARDSIGHT_API_KEY")
    if not resolved_api_key:
        raise ValueError("Provide api_key or set the CARDSIGHT_API_KEY environment variable.")

    cards = fetch_all_cards(
        resolved_api_key,
        release_id,
        take=take,
        skip=skip,
        order=order,
    )
    write_cards_csv(cards, output_path, force_recreate=force_recreate)
    return len(cards)


if __name__ == "__main__":
    raise SystemExit("Import load_cards() from another script and pass a release_id.")