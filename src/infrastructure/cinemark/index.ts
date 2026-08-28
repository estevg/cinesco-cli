// Cinemark provider — composes metadata + catalog + purchase adapters.
import type { Provider } from "../../domain/ports.ts";
import { cinemarkCatalog } from "./catalog.ts";
import { cinemarkPurchase } from "./purchase.ts";

export const cinemark: Provider = {
  id: "cinemark",
  name: "Cinemark",
  country: "Colombia",
  auth: "direct",
  notes: "Vista via api.cinemark-core.com. Todo headless (browse, login, compra). Pago = PSE/PayU.",
  capabilities: { browse: true, seatmap: true, reserve: true, checkout: true },
  catalog: cinemarkCatalog,
  purchase: cinemarkPurchase,
};
