import { describe, expect, it } from "vitest";
import { randomSalt, sec2Credentials } from "./srp6a";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// ESP-IDF components/protocomm/test_apps/main/test_srp.c: the salt and the
// verifier the board accepts for username "wifiprov", password "abcd1234".
const IDF_SALT = Uint8Array.from("036ee0c7bcb9eda84c9eac97d93decf4".match(/../g)!, (h) => parseInt(h, 16));
const IDF_VERIFIER =
  "7c7c85476508946dd636af37d7e8914378cffd616c59d2f83908127238de9e24a470261cdfa903c2b270e7b13224da11" +
  "1d9718dc607208cc9ac90c4827e2ae89aa1625b804d21a9b3a8f37f6e43a712ee127866eadce28ff5446601fb99687dc" +
  "5740a7d46cc97754dc1682f0ed356ac470ad3d90b5819470d7bc65b2d518e02ec3a5f968dd647bb8b73c9cfc00d8717e" +
  "b79a7cb1b7c2c318342932433e0099e98294e3d82ab09629b7df0e5f08334076529132009f972c896c391ec828054417" +
  "3f68028a9f4461d1f5a17e5a70d2c72381cb3868e42c20bc40577617bd08b896bc26eb32466935058c1570d91be9becc" +
  "a938a667f0ad5013197264bf52c234e21b11797472bd345bb1e2fd6673fe716474d04ebc51241940870e9240e621e72d" +
  "4e37762f2ee268c789e8321342068484534ab30c1b4c8d1c519719abae77ffdbecf0109534336bcb3e840fb9d85fb8a0" +
  "b855533e70f718f5ce7b4ebf27cecea8b3be40c5c532293e71649ede8cf675a1e6f653c831a878de5040f762de36b2ba";

describe("sec2Credentials", () => {
  it("reproduces ESP-IDF's own verifier for its test credentials", async () => {
    const { salt, verifier } = await sec2Credentials("wifiprov", "abcd1234", IDF_SALT);
    expect(hex(salt)).toBe(hex(IDF_SALT));
    expect(hex(verifier)).toBe(IDF_VERIFIER);
  });

  it("makes a 16-byte salt and a 384-byte verifier by default", async () => {
    const { salt, verifier } = await sec2Credentials("3acfd08f-bb42-4c5a-a2ac-8d4160b25f0c", "s3cret-pass");
    expect(salt).toHaveLength(16);
    expect(verifier.length).toBeGreaterThan(380);
    expect(verifier.length).toBeLessThanOrEqual(384);
  });

  it("never starts a salt with a zero byte", () => {
    for (let i = 0; i < 200; i++) expect(randomSalt()[0]).not.toBe(0);
  });
});
