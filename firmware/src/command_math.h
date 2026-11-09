#pragma once

// Whether a command is too old to act on, as pure arithmetic (host-tested in
// test/test_command_math). CLAUDE.md §4: a command carries issued_at (Unix
// seconds) and ttl; a device that reconnects after a long outage must not act
// on a stale instruction.

#include <stdint.h>

// Clock disagreement between the board and the platform this small is not
// "expired" (SNTP is good to well under a second; this covers a slow sync).
constexpr int64_t COMMAND_CLOCK_GRACE_S = 2;

// Any time before this means the clock hasn't been set yet (it starts at 1970).
constexpr int64_t CLOCK_VALID_AFTER = 1700000000;  // Nov 2023

// True only when the clock is known and the command says when it was issued
// and for how long it's good: without either, the command is acted on, as
// every firmware before 0.15.1 did.
inline bool commandExpired(int64_t nowS, int64_t issuedAt, int64_t ttl) {
  if (nowS < CLOCK_VALID_AFTER || issuedAt <= 0 || ttl <= 0) return false;
  return nowS > issuedAt + ttl + COMMAND_CLOCK_GRACE_S;
}
