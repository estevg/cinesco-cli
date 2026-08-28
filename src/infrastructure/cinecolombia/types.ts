// The contract every cinema chain implements. The umbrella CLI routes to one of
// these; each provider knows how to talk to its own backend.
//
// Providers differ underneath: Royal Films is a bespoke JWT API (login is a plain
// email+password call, everything works headless); Cine Colombia is a Vista OCAPI
// whose login is reCAPTCHA-gated (browser-assisted) though browse is headless.
// The interface captures what they share and flags what they don't.

export interface Cinema {
  id: string;
  name: string;
  region?: string; // city id/name the cinema belongs to (provider-specific)
}

export interface Movie {
  id: string;
  title: string;
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
}

export interface ProviderCapabilities {
  browse: boolean; // list cinemas/movies/showtimes
  seatmap: boolean; // fetch/paint a seat map
  reserve: boolean; // hold seats
  checkout: boolean; // generate a payment session/link
}

export interface ProviderMeta {
  id: string; // slug: "royalfilms", "cinecolombia"
  name: string; // "Royal Films"
  country: string; // "Colombia"
  auth: "direct" | "browser-assisted"; // how a session is obtained
  notes?: string;
  capabilities: ProviderCapabilities;
}

// A region is an opaque provider-specific scope (a Royal Films city id, a Cine
// Colombia site id). The umbrella passes it through without interpreting it.
export interface Provider extends ProviderMeta {
  // Browse — the surface both chains expose.
  listRegions?(): Promise<Cinema[]>; // optional: cities/zones to scope by
  listCinemas(region?: string): Promise<Cinema[]>;
  listMovies(region?: string): Promise<Movie[]>;
  listShowtimes(opts: { movieId: string; region?: string; cinemaId?: string }): Promise<Showtime[]>;
}

// Thrown by an adapter when an operation isn't wired yet (skeleton stage).
export class NotImplemented extends Error {
  code = "not-implemented";
  constructor(what: string) {
    super(what);
  }
}
