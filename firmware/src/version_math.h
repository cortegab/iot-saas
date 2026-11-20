#pragma once

#include <stdlib.h>

// "1.2.3" -> true with the three parts; false for anything else. Pure, so the
// native tests cover it (test/test_version_math).
inline bool parseVersion(const char* s, long out[3]) {
  for (int i = 0; i < 3; i++) {
    char* end = nullptr;
    if (*s < '0' || *s > '9') return false;
    out[i] = strtol(s, &end, 10);
    if (out[i] < 0 || out[i] > 9999) return false;
    s = end;
    if (i < 2) {
      if (*s != '.') return false;
      s++;
    }
  }
  return *s == '\0';
}

// Whether `candidate` is a strictly newer version than `current`. An
// unparseable one is never newer: the board doesn't install what it can't
// order (and so never goes back to an older signed release).
inline bool isNewerVersion(const char* candidate, const char* current) {
  long a[3], b[3];
  if (!parseVersion(candidate, a) || !parseVersion(current, b)) return false;
  for (int i = 0; i < 3; i++)
    if (a[i] != b[i]) return a[i] > b[i];
  return false;
}
