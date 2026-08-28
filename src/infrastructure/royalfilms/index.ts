// Royal Films provider — CatalogPort (browse) + PurchasePort (login → seatMap →
// reserve → sale → ePayco link). Prices are per seat, so no Fare is chosen.
import type { Provider } from "../../domain/ports.ts";
import { royalfilmsCatalog } from "./catalog.ts";
import { royalfilmsPurchase } from "./purchase.ts";

export const royalfilms: Provider = {
  id: "royalfilms",
  name: "Royal Films",
  country: "Colombia",
  auth: "direct",
  notes: "Login directo email+password → JWT. Todo headless. Pago = ePayco.",
  capabilities: { browse: true, seatmap: true, reserve: true, checkout: true },
  catalog: royalfilmsCatalog,
  purchase: royalfilmsPurchase,
};
