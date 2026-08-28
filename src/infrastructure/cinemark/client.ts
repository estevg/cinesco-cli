// Cinemark Colombia low-level client. Backend is Vista via api.cinemark-core.com;
// the order/payment routes live on the Next.js backend at www.cinemark.com.co.
// Reads need only connectapitoken; writes need the x-fingerprint-id device JWT
// (24h) returned in the login response header.
import { getJson, postJson, postJsonWithHeaders } from "../http.ts";
import { createPublicKey, publicEncrypt, constants as cryptoConstants } from "node:crypto";

export const CORE = "https://api.cinemark-core.com";
export const WWW = "https://www.cinemark.com.co";
export const CO = {
  companyId: "5db771be04daec00076df3f5",
  clientId: "5e2873739eb5e20007f4ba37",
  country: "co",
  connectapitoken: "web-co-token",
  midnightStart: "23:10",
  midnightEnd: "03:00",
  optionalClientId: "111.111.0.130",
} as const;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152 Safari/537.36";

let RANDOM_FP: string | null = null;
function randomFingerprint(): string {
  return (RANDOM_FP ??= crypto.randomUUID());
}

// Headers for a request. Reads use a throwaway fingerprint; writes MUST pass the real
// device JWT captured at login.
export function headers(fp?: string, extra?: Record<string, string>): Record<string, string> {
  return {
    "User-Agent": UA,
    connectapitoken: CO.connectapitoken,
    "x-fingerprint-id": fp || randomFingerprint(),
    Origin: WWW,
    Referer: `${WWW}/`,
    ...extra,
  };
}

export const vista = (p: string) => `/vista/country/${CO.country}${p}`;
export const ordersApi = (p: string) => `/api/orders/country/${CO.country}${p}`;

export const coreGet = <T>(path: string, fp?: string) => getJson<T>(`${CORE}${path}`, { headers: headers(fp) });
export const corePost = <T>(path: string, body: unknown, fp?: string) =>
  postJson<T>(`${CORE}${path}`, body, { headers: headers(fp) });
export const wwwGet = <T>(path: string, fp: string) => getJson<T>(`${WWW}${path}`, { headers: headers(fp) });
export const wwwPost = <T>(path: string, body: unknown, fp: string) =>
  postJson<T>(`${WWW}${path}`, body, { headers: headers(fp) });

// loyalty/login returns the LoyaltySessionToken (body) + the x-fingerprint-id (header).
export function loyaltyLogin(body: unknown) {
  return postJsonWithHeaders<any>(`${CORE}${vista("/loyalty/login")}`, body, { headers: headers() });
}

// PaymentInfo is a FIXED voucher stub encrypted with the payments RSA-4096 key using
// RSA-OAEP-SHA256 (node-forge in the web app; node crypto here). Verified to match.
export async function encryptPaymentInfo(fp: string): Promise<string> {
  const { publicKey } = await wwwGet<{ publicKey: string }>(`/api/payments/encryption/public-key`, fp);
  const plain = JSON.stringify({ CardNumber: "8888888888888888", CardType: "VOUCHERW", PaymentInfo: "-", PaymentValueCents: 0 });
  const enc = publicEncrypt(
    { key: createPublicKey(publicKey), padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(plain),
  );
  return enc.toString("base64");
}
