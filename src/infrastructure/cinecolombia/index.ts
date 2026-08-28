// Cine Colombia provider — CatalogPort (browse) + PurchasePort (browser-assisted:
// login opens a browser; reserve drives it to create the order + PlacetoPay link).
import type { Provider } from "../../domain/ports.ts";
import { cinecolombiaCatalog } from "./catalog.ts";
import { cinecolombiaPurchase } from "./purchase.ts";

export const cinecolombia: Provider = {
  id: "cinecolombia",
  name: "Cine Colombia",
  country: "Colombia",
  auth: "browser-assisted",
  notes: "Vista OCAPI. Navegar es headless; login/compra van por navegador (Cloudflare + reCAPTCHA). Pago = PlacetoPay.",
  capabilities: { browse: true, seatmap: true, reserve: true, checkout: true },
  catalog: cinecolombiaCatalog,
  purchase: cinecolombiaPurchase,
};
