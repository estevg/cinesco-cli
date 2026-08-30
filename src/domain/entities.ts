// Domain entities — pure, provider-agnostic. No I/O, no framework, no chain specifics.
// Every adapter maps its own API shapes onto these; use cases and the CLI speak only
// these types.

export interface Region {
  id: string;
  name: string;
}

export interface Cinema {
  id: string;
  name: string;
  regionId?: string;
  address?: string;
  city?: string; // the theater's real city name (may differ from the region slug)
}

export interface Movie {
  id: string;
  title: string;
  rating?: string;
}

export interface Showtime {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM
  cinemaId: string;
  cinemaName?: string;
  movieId?: string;
  hall?: string;
  format?: string;
  seatsFree?: number; // filled on demand (showtimes --occupancy); not in the base listing
  seatsTotal?: number;
}

export interface Seat {
  id: string; // provider seat id (unique within the map)
  label: string; // human label, e.g. "K11"
  row: string; // row name
  column: number; // grid column
  available: boolean;
  special?: boolean; // preferential / premium zone
  category?: string; // pricing/zone code
  priceCents?: number; // set when the chain prices per seat (Royal Films); else a Fare applies
  meta?: Record<string, unknown>; // adapter-only extras needed to reserve (e.g. grid indices)
}

export interface SeatMap {
  cinemaId: string;
  showtimeId: string;
  columns: number;
  rows: { name: string; seats: Seat[] }[];
  categories?: { code: string; name: string }[];
}

export interface Member {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  documentId?: string;
}

// A logged-in session. `member` is common; `credentials` carries opaque, adapter-only
// tokens (JWT, fingerprint, cookies…) that the CLI never inspects.
export interface Session {
  provider: string;
  member?: Member;
  credentials: Record<string, unknown>;
}

export interface Fare {
  code: string;
  name: string;
  priceCents: number;
  category?: string;
}

export interface PaymentMethod {
  code: string;
  name: string;
}

// A held/created order awaiting payment. Never charged by the CLI.
export interface Order {
  id: string;
  total: number; // in the chain's currency major units (COP pesos)
  seatLabels: string[];
  meta?: Record<string, unknown>;
}

// The external payment link the human opens to pay. The CLI stops here.
export interface PaymentLink {
  provider: string;
  orderId: string;
  url: string;
  method?: string;
}
