/**
 * SRP6a salt + verifier for ESP-IDF provisioning Security 2
 * (docs/ble-provisioning.md). Matches ESP-IDF protocomm's esp_srp.c, which is
 * what the board checks the phone against:
 *
 *   group  RFC 5054 3072-bit N, g = 5
 *   hash   SHA-512
 *   x      = H(salt ‖ H(username ":" password))
 *   v      = g^x mod N
 *
 * The verifier is computed here, in the browser, so the sketch can embed it.
 */

const N_HEX =
  "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74" +
  "020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f1437" +
  "4fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed" +
  "ee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf05" +
  "98da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb" +
  "9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3b" +
  "e39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf695581718" +
  "3995497cea956ae515d2261898fa051015728e5a8aaac42dad33170d04507a33" +
  "a85521abdf1cba64ecfb850458dbef0a8aea71575d060c7db3970f85a6e1e4c7" +
  "abf5ae8cdb0933d71e8c94e04a25619dcee3d2261ad2ee6bf12ffa06d98a0864" +
  "d87602733ec86a64521f2b18177b200cbbe117577a615d6c770988c0bad946e2" +
  "08e24fa074e5ab3143db5bfce0fd108e4b82d120a93ad2caffffffffffffffff";
const N = BigInt("0x" + N_HEX);
const G = 5n;
const SALT_LEN = 16;

const enc = new TextEncoder();

async function sha512(...parts: Uint8Array[]): Promise<Uint8Array> {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-512", buf));
}

const toBig = (b: Uint8Array) => BigInt("0x" + (Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("") || "0"));

function toBytes(n: bigint): Uint8Array {
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/** A random 16-byte salt whose first byte isn't zero: the board treats the
 * salt as a big number, so a leading zero byte would be dropped somewhere. */
export function randomSalt(): Uint8Array {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  if (salt[0] === 0) salt[0] = 1;
  return salt;
}

/** The salt and verifier the board stores for (username, password). */
export async function sec2Credentials(
  username: string,
  password: string,
  salt: Uint8Array = randomSalt(),
): Promise<{ salt: Uint8Array; verifier: Uint8Array }> {
  const inner = await sha512(enc.encode(username), enc.encode(":"), enc.encode(password));
  const x = toBig(await sha512(salt, inner));
  return { salt, verifier: toBytes(modPow(G, x, N)) };
}
