import { test, expect } from "bun:test";
import { buildSessionData, buildCheckoutHtml, billingFromToken } from "./checkout.ts";

function makeToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

test("buildSessionData matches the observed ePayco shape", () => {
  const billing = {
    email: "e@x.com",
    name: "Esteban Vega",
    address: "Calle 14",
    typeDoc: "CC",
    numberDoc: "123",
    callingCode: "+57",
    mobilePhone: "311",
  };
  const sd = buildSessionData({ posEpayco: 1, multicineCodigo: 10, amount: 17000, billing, invoiceRef: "R99" });
  expect(sd.posicion).toBe(1);
  expect(sd.data.amount).toBe(17000);
  expect(sd.data.currency).toBe("COP");
  expect(sd.data.checkout_version).toBe("2");
  expect(sd.data.invoice).toBe("10-R99");
  expect(sd.data.test).toBe(false);
  expect(sd.data.billing.email).toBe("e@x.com");
  expect(sd.data.extras.extra1).toBe("R99");
});

test("billingFromToken pulls profile fields from the JWT", () => {
  const tok = makeToken({
    user: {
      usuario_cliente_correo: "e@x.com",
      usuario_cliente_nombres: "Esteban",
      usuario_cliente_apellidos: "Vega",
      usuario_cliente_direccion: "Calle 14",
      usuario_cliente_documento: "123",
      usuario_cliente_telefono: "311",
    },
  });
  const b = billingFromToken(tok);
  expect(b.name).toBe("Esteban Vega");
  expect(b.numberDoc).toBe("123");
  expect(b.mobilePhone).toBe("311");
  expect(b.typeDoc).toBe("CC");
});

test("buildCheckoutHtml embeds the sessionId and the ePayco SDK", () => {
  const html = buildCheckoutHtml("SID123", "$17.000");
  expect(html).toContain("SID123");
  expect(html).toContain("checkout.epayco.co/checkout-v2.js");
  expect(html).toContain("ePayco.checkout.configure");
  expect(html).toContain("$17.000");
});
