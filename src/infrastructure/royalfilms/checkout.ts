import { apiPost } from "./api.ts";
import { decodeJwt } from "./session.ts";

// ePayco payment session. Observed shape of POST /epayco/getSessionId {sessionData}
// (reverse-engineered from the web bundle, verified live: returns {status:true, data:"<sessionId>"}).
// NOTE: this creates only an ePayco payment SESSION — it does NOT create a /sale on the
// cinema side, so no order is placed and nothing is charged until a human submits payment
// in ePayco's own form. Building it this way is the low-risk path.

export interface Billing {
  email: string;
  name: string;
  address: string;
  typeDoc: string;
  numberDoc: string;
  callingCode: string;
  mobilePhone: string;
}

export function billingFromToken(token: string): Billing {
  const u = (decodeJwt(token).user ?? {}) as Record<string, unknown>;
  return {
    email: String(u.usuario_cliente_correo ?? ""),
    name: `${u.usuario_cliente_nombres ?? ""} ${u.usuario_cliente_apellidos ?? ""}`.trim(),
    address: String(u.usuario_cliente_direccion ?? ""),
    typeDoc: "CC",
    numberDoc: String(u.usuario_cliente_documento ?? ""),
    callingCode: "+57",
    mobilePhone: String(u.usuario_cliente_telefono ?? ""),
  };
}

export interface SessionData {
  posicion: number;
  data: {
    test: boolean;
    checkout_version: string;
    name: string;
    currency: string;
    amount: number;
    description: string;
    lang: string;
    invoice: string;
    country: string;
    response: string;
    extras: { extra1: string; extra2: string };
    billing: Billing;
  };
}

export function buildSessionData(opts: {
  posEpayco: number;
  multicineCodigo: number | string;
  amount: number;
  billing: Billing;
  invoiceRef: string; // e.g. a reservation id or a unique ref
}): SessionData {
  return {
    posicion: opts.posEpayco,
    data: {
      test: false,
      checkout_version: "2",
      name: "Pago Online Royal Films",
      currency: "COP",
      amount: opts.amount,
      description: "Pago Online Royal Films",
      lang: "ES",
      invoice: `${opts.multicineCodigo}-${opts.invoiceRef}`,
      country: "CO",
      response: `https://cinemasroyalfilms.com/confirmacion/${opts.invoiceRef}`,
      extras: { extra1: String(opts.invoiceRef), extra2: opts.billing.email },
      billing: opts.billing,
    },
  };
}

export function getSessionId(sessionData: SessionData, token: string): Promise<string> {
  return apiPost<string>(`/epayco/getSessionId`, { sessionData }, token);
}

// A self-contained page that loads ePayco's SDK (the same the site uses) and opens the
// on-page checkout for this sessionId. Opening it in a browser shows ePayco's real
// payment form (card, PSE/bank) prefilled from the session — the human decides whether
// to actually pay.
export function buildCheckoutHtml(sessionId: string, amountLabel: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Pago Royal Films</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0f1115;color:#e6e6e6;display:flex;
    min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{max-width:420px;text-align:center;padding:2rem}
  button{background:#00c389;color:#022;border:0;border-radius:8px;padding:.9rem 1.6rem;
    font-size:1rem;font-weight:600;cursor:pointer}
  .muted{color:#8b93a1;font-size:.9rem;margin-top:1rem}
  code{color:#6cc}
</style>
</head>
<body>
  <div class="card">
    <h2>Royal Films · Pago</h2>
    <p>Total: <strong>${amountLabel}</strong></p>
    <p>Se abrirá el formulario de ePayco. Podés ver y llenar los datos;
       el pago solo se realiza si vos lo confirmás.</p>
    <button id="pay">Abrir formulario de pago</button>
    <p class="muted">sessionId: <code>${sessionId}</code></p>
  </div>
  <script src="https://checkout.epayco.co/checkout-v2.js"></script>
  <script>
    function openCheckout(){
      var handler = ePayco.checkout.configure({ sessionId: "${sessionId}", type: "onpage", test: false });
      handler.open();
    }
    document.getElementById("pay").addEventListener("click", openCheckout);
    // auto-open once the SDK is ready
    window.addEventListener("load", function(){ setTimeout(openCheckout, 400); });
  </script>
</body>
</html>`;
}
