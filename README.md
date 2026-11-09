# baseball_card_tracker

## Fetch CardSight catalog attributes

The Python CLI uses the standard library and sends the attributes query with the
same defaults as the example (`take=20`, `skip=0`, `shortName=MLB`, `order=asc`).
Set your CardSight API key in the environment; do not put it in the source file:

```sh
export CARDSIGHT_API_KEY="your-api-key"
python3 cardsight_attributes.py
```

Optional query arguments are `--take`, `--skip`, `--short-name`, and `--order`
(`asc` or `desc`). Run the offline request tests with:

```sh
python3 -m unittest test_cardsight_attributes
```