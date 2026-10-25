"""Paging for the history feeds (commands, rule executions, rule versions,
notifications, failed deliveries).

Each endpoint takes `limit` and `offset` query parameters whose defaults keep
its old fixed cap, so callers that send neither behave as before. The total
row count goes in the `X-Total-Count` header rather than wrapping the body:
the response models, and every existing consumer, stay as they were. CORS
exposes the header (main.py) because the dev frontend calls the API
cross-origin.
"""

from fastapi import Query, Response

TOTAL_HEADER = "X-Total-Count"
# Bounded, but enough for the notifications page to show the latest 500 in
# one request (its "Show older" grows one request rather than paging).
MAX_LIMIT = 500


def limit_param(default: int) -> int:
    """`limit` with this endpoint's old cap as its default."""
    result: int = Query(default, ge=1, le=MAX_LIMIT, description="Rows per page.")
    return result


OFFSET = Query(0, ge=0, description="Rows to skip, newest first.")


def set_total(response: Response, total: int) -> None:
    response.headers[TOTAL_HEADER] = str(total)
