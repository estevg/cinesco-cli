import { test, expect } from "bun:test";
import { generateKeyPairSync, privateDecrypt, constants } from "node:crypto";
import { rsaOaepSha256, VOUCHER_STUB, headers, CO } from "./client.ts";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

test("rsaOaepSha256 round-trips through the matching private key", () => {
  const b64 = rsaOaepSha256(publicKey, VOUCHER_STUB);
  const back = privateDecrypt(
    { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(b64, "base64"),
  ).toString();
  expect(back).toBe(VOUCHER_STUB);
});

test("the SHA-256 OAEP hash is load-bearing (wrong padding/hash fails)", () => {
  const b64 = rsaOaepSha256(publicKey, VOUCHER_STUB);
  const buf = Buffer.from(b64, "base64");
  // PKCS1 v1.5 — the original bug ("could not decrypt payment data")
  expect(() => privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, buf)).toThrow();
  // OAEP but with the default SHA-1 hash instead of SHA-256
  expect(() => privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" }, buf)).toThrow();
});

test("the voucher stub carries no real card data", () => {
  const v = JSON.parse(VOUCHER_STUB);
  expect(v.CardType).toBe("VOUCHERW");
  expect(v.PaymentValueCents).toBe(0);
  expect(v.CardNumber).toMatch(/^8+$/); // all-8s placeholder, not a real PAN
});

test("headers inject the real device fingerprint and the public token", () => {
  const h = headers("device-jwt-123", { "x-extra": "1" });
  expect(h["x-fingerprint-id"]).toBe("device-jwt-123");
  expect(h.connectapitoken).toBe(CO.connectapitoken); // public web-co-token
  expect(h["x-extra"]).toBe("1");
});

test("headers fall back to a random fingerprint for reads", () => {
  const a = headers()["x-fingerprint-id"];
  const b = headers()["x-fingerprint-id"];
  expect(a).toBeTruthy();
  expect(a).toBe(b); // stable within the process (reused throwaway id)
});
