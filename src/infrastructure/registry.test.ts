import { test, expect } from "bun:test";
import { PROVIDERS, getProvider } from "./registry.ts";
import { tokenExp } from "./cinecolombia/cinecolombia-token.ts";

test("registry exposes the three chains with valid metadata + a catalog port", () => {
  const ids = PROVIDERS.map((p) => p.id);
  expect(ids).toEqual(expect.arrayContaining(["royalfilms", "cinecolombia", "cinemark"]));
  for (const p of PROVIDERS) {
    expect(p.id).toMatch(/^[a-z]+$/);
    expect(p.name.length).toBeGreaterThan(0);
    expect(["direct", "browser-assisted"]).toContain(p.auth);
    expect(typeof p.capabilities.browse).toBe("boolean");
    expect(typeof p.catalog.listCinemas).toBe("function");
    expect(typeof p.catalog.listMovies).toBe("function");
    expect(typeof p.catalog.listShowtimes).toBe("function");
  }
});

test("getProvider resolves and rejects", () => {
  expect(getProvider("royalfilms")?.name).toBe("Royal Films");
  expect(getProvider("cinemark")?.name).toBe("Cinemark");
  expect(getProvider("nope")).toBeUndefined();
});

test("every chain exposes a purchase port with the full step surface", () => {
  for (const p of PROVIDERS) {
    expect(p.purchase).toBeDefined();
    expect(typeof p.purchase!.login).toBe("function");
    expect(typeof p.purchase!.getSeatMap).toBe("function");
    expect(typeof p.purchase!.reserve).toBe("function");
    expect(typeof p.purchase!.pay).toBe("function");
  }
});

test("capabilities reflect the recon state", () => {
  expect(getProvider("royalfilms")!.capabilities).toEqual({ browse: true, seatmap: true, reserve: true, checkout: true });
  expect(getProvider("cinecolombia")!.auth).toBe("browser-assisted");
  expect(getProvider("cinemark")!.auth).toBe("direct");
});

test("tokenExp reads the JWT expiry", () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  expect(tokenExp(`${b64({ alg: "RS256" })}.${b64({ exp: 1787580308 })}.sig`)).toBe(1787580308);
  expect(tokenExp("not-a-jwt")).toBe(0);
});
