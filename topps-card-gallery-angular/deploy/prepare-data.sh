#!/bin/sh
set -eu

deploy_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_file="$deploy_directory/../data/cardsight_cards_named_attributes.json"
data_directory="$deploy_directory/data"
destination_file="$data_directory/cards.json"

if [ -e "$destination_file" ]; then
  printf 'Keeping existing ownership data at %s\n' "$destination_file"
  exit 0
fi

if [ ! -f "$source_file" ]; then
  printf 'CardSight export not found: %s\n' "$source_file" >&2
  exit 1
fi

mkdir -p "$data_directory"
cp "$source_file" "$destination_file"
chmod 600 "$destination_file"
printf 'Prepared persistent catalog at %s\n' "$destination_file"