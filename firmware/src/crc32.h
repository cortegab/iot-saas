#pragma once

#include <stddef.h>
#include <stdint.h>

// CRC-32 (IEEE 802.3, the zlib one). Written out rather than the ROM's so the
// browser's implementation (frontend/src/lib/hardware/config-blob.ts) matches
// it bit for bit without depending on the ROM's init/xor conventions.
inline uint32_t crc32Ieee(const uint8_t* data, size_t len) {
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (int k = 0; k < 8; k++) crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
  }
  return ~crc;
}
