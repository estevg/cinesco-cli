// Ports — the interfaces adapters implement and use cases depend on (Dependency
// Inversion). Split by capability (Interface Segregation): a browse-only chain
// implements CatalogPort and omits PurchasePort.
import type {
  Region, Cinema, Movie, Showtime, SeatMap, Seat, Session, Fare, Order, PaymentLink, PaymentMethod,
} from "./entities.ts";

export interface ProviderCapabilities {
  browse: boolean;
  seatmap: boolean;
  reserve: boolean;
  checkout: boolean;
}

export interface ProviderMeta {
  id: string; // slug: "royalfilms" | "cinecolombia" | "cinemark"
  name: string;
  country: string;
  auth: "direct" | "browser-assisted";
  notes?: string;
  capabilities: ProviderCapabilities;
}

// Read side — browse the catalog. Regions are optional (some chains aren't scoped by city).
export interface CatalogPort {
  listRegions?(): Promise<Region[]>;
  listCinemas(regionId?: string): Promise<Cinema[]>;
  listMovies(regionId?: string): Promise<Movie[]>;
  listShowtimes(query: { movieId: string; regionId?: string; cinemaId?: string }): Promise<Showtime[]>;
}

// Write side — the purchase flow. Creating an order holds seats; paying only ever
// yields a link (the human pays externally — the CLI never charges).
export interface PurchasePort {
  login(credentials: { email: string; password: string }): Promise<Session>;
  // Rebuild a Session from a locally persisted credential (e.g. a saved login
  // token) with no network call. Returns null when there is nothing usable —
  // no stored session, or it expired. Optional: chains without a local session
  // store simply omit it, and the caller falls back to `login`.
  restore?(): Promise<Session | null>;
  getSeatMap(showtime: Showtime, session: Session): Promise<SeatMap>;
  listFares(showtime: Showtime, session: Session): Promise<Fare[]>;
  paymentMethods(): PaymentMethod[]; // empty when the chain has no choice to make
  reserve(input: ReserveInput): Promise<Order>;
  pay(input: PayInput): Promise<PaymentLink>;
}

export interface ReserveInput {
  session: Session;
  showtime: Showtime;
  movie: Movie;
  regionId?: string;
  seats: Seat[];
  fare?: Fare; // required by per-ticket chains (Cinemark); ignored by per-seat ones (Royal Films)
}

export interface PayInput {
  session: Session;
  order: Order;
  showtime: Showtime;
  movie: Movie;
  seats: Seat[];
  method?: PaymentMethod;
}

// A provider composes its metadata with the capabilities it actually offers.
export interface Provider extends ProviderMeta {
  catalog: CatalogPort;
  purchase?: PurchasePort;
}
