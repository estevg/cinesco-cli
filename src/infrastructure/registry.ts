// Provider registry — the composition root. Add a chain by writing an adapter and
// registering it here (Open/Closed: use cases and presentation never change).
import type { Provider } from "../domain/ports.ts";
import { royalfilms } from "./royalfilms/index.ts";
import { cinecolombia } from "./cinecolombia/index.ts";
import { cinemark } from "./cinemark/index.ts";

export const PROVIDERS: Provider[] = [royalfilms, cinecolombia, cinemark];

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
