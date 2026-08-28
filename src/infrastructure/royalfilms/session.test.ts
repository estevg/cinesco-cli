import { test, expect } from "bun:test";
import { decodeJwt, userFromToken, isExpired, type Session } from "./session.ts";

// A JWT with a payload we control (signature is a dummy; we never verify it).
function makeToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

test("decodeJwt reads the payload", () => {
  const tok = makeToken({ user: { usuario_cliente_id: 42 }, exp: 999 });
  const p = decodeJwt(tok);
  expect(p.exp).toBe(999);
  expect((p.user as Record<string, unknown>).usuario_cliente_id).toBe(42);
});

test("userFromToken extracts id and profile", () => {
  const tok = makeToken({
    user: {
      usuario_cliente_id: 1596481,
      usuario_cliente_nombres: "Esteban",
      usuario_cliente_correo: "e@x.com",
    },
    exp: 123,
  });
  const { user, exp } = userFromToken(tok);
  expect(user.id).toBe(1596481);
  expect(user.nombres).toBe("Esteban");
  expect(user.correo).toBe("e@x.com");
  expect(exp).toBe(123);
});

test("userFromToken rejects a token with no user id", () => {
  const tok = makeToken({ user: {}, exp: 1 });
  expect(() => userFromToken(tok)).toThrow();
});

test("isExpired respects exp and skew", () => {
  const future: Session = { token: "t", user: { id: 1 }, exp: Date.now() / 1000 + 3600 };
  const past: Session = { token: "t", user: { id: 1 }, exp: Date.now() / 1000 - 10 };
  expect(isExpired(future)).toBe(false);
  expect(isExpired(past)).toBe(true);
});
