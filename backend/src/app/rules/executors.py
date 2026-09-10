"""Action-executor registry for the deferred (non-actuator) rule actions.

Actuator commands stay inline on the hot path in `rules/service.py` — they
never come here. Webhook and email actions are dispatched from a background
task (`rules/service.py::_run_deferred_action`) so a slow or failing endpoint
can no longer stall telemetry ingestion, and so they can be retried with
bounded exponential backoff.

Each executor is a pure `async execute(config, ctx) -> ActionResult`. The
retry loop (`execute_with_retry`) is here too; `_sleep` is a module-level
alias of `asyncio.sleep` so tests can neutralise the backoff.
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any, NamedTuple, Protocol

import httpx

from app.notifications.email import EmailMessage, get_email_provider

log = logging.getLogger("rules.executors")

# Mirrors rules/service.py's constant — keep the two in sync if either moves.
_DETAIL_STRING_MAX = 500

# Default: 4 attempts (initial + 3 retries), ~7s of backoff worst case.
_BACKOFF_SCHEDULE: tuple[float, ...] = (1.0, 2.0, 4.0)
_DEFAULT_TIMEOUT_S = 5.0

_sleep = asyncio.sleep


class ActionResult(NamedTuple):
    status: str  # "success" | "failed"
    detail: dict[str, Any]


@dataclass(frozen=True)
class ActionContext:
    tenant_id: uuid.UUID
    rule_id: uuid.UUID
    rule_name: str


def _truncate(value: str) -> str:
    return value[:_DETAIL_STRING_MAX]


def parse_retry(config: dict[str, Any]) -> tuple[int, float]:
    """(max_attempts, per-attempt timeout_s) from an action's optional
    `retry` block, clamped to sane bounds. Mirrors schemas.RetryConfig."""
    retry = config.get("retry") or {}
    max_attempts = retry.get("max_attempts", len(_BACKOFF_SCHEDULE) + 1)
    max_attempts = max(2, min(6, int(max_attempts)))
    timeout_s = config.get("timeout_s") or retry.get("timeout_s") or _DEFAULT_TIMEOUT_S
    timeout_s = max(1.0, min(30.0, float(timeout_s)))
    return max_attempts, timeout_s


class Executor(Protocol):
    async def execute(self, config: dict[str, Any], ctx: ActionContext) -> ActionResult: ...


class WebhookExecutor:
    async def execute(self, config: dict[str, Any], ctx: ActionContext) -> ActionResult:
        _, timeout_s = parse_retry(config)
        url = str(config["url"])
        started = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                response = await client.post(url, json=config.get("body", {}))
        except httpx.HTTPError as exc:
            return ActionResult(
                "failed",
                {
                    "url": _truncate(url),
                    "error": _truncate(str(exc)),
                    "elapsed_ms": _elapsed(started),
                },
            )
        detail = {
            "url": _truncate(url),
            "status_code": response.status_code,
            "elapsed_ms": _elapsed(started),
        }
        # 4xx = delivered but rejected by the endpoint — not worth retrying.
        # 5xx / network / timeout = retry-worthy failure.
        status = "failed" if response.status_code >= 500 else "success"
        return ActionResult(status, detail)


class EmailExecutor:
    async def execute(self, config: dict[str, Any], ctx: ActionContext) -> ActionResult:
        # A provider send failure raises — execute_with_retry catches it,
        # records the error, and retries with backoff.
        recipients: list[str] = list(config["to"])
        message = EmailMessage(
            to=recipients, subject=str(config["subject"]), body=str(config["body"])
        )
        await get_email_provider().send(message)
        return ActionResult("success", {"recipients_count": len(recipients)})


def _elapsed(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


ACTION_EXECUTORS: dict[str, Executor] = {
    "webhook": WebhookExecutor(),
    "email": EmailExecutor(),
}


async def execute_with_retry(kind: str, config: dict[str, Any], ctx: ActionContext) -> ActionResult:
    """Run `kind`'s executor, retrying a `failed` result (or a raised
    exception) with exponential backoff. Returns the terminal result with
    `detail["attempts"]` set. Bounded — worst case is `max_attempts` runs
    plus the fixed backoff schedule."""
    executor = ACTION_EXECUTORS[kind]
    max_attempts, _ = parse_retry(config)
    result: ActionResult = ActionResult("failed", {"error": "not attempted"})
    for attempt in range(1, max_attempts + 1):
        try:
            result = await executor.execute(config, ctx)
        except Exception as exc:
            log.exception("executor %s raised for rule %s", kind, ctx.rule_id)
            result = ActionResult("failed", {"error": _truncate(str(exc))})
        if result.status == "success":
            return ActionResult("success", {**result.detail, "attempts": attempt})
        if attempt < max_attempts:
            delay = _BACKOFF_SCHEDULE[min(attempt - 1, len(_BACKOFF_SCHEDULE) - 1)]
            await _sleep(delay)
    return ActionResult("failed", {**result.detail, "attempts": max_attempts})
