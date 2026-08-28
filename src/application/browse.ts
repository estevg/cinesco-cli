// Browse use case — thin orchestration over a CatalogPort (Dependency Inversion:
// depends on the interface, not on any chain).
import type { CatalogPort } from "../domain/ports.ts";
import type { Region, Cinema, Movie, Showtime } from "../domain/entities.ts";

export class BrowseCatalog {
  constructor(private readonly catalog: CatalogPort) {}

  regions(): Promise<Region[]> {
    return this.catalog.listRegions?.() ?? Promise.resolve([]);
  }
  cinemas(regionId?: string): Promise<Cinema[]> {
    return this.catalog.listCinemas(regionId);
  }
  movies(regionId?: string): Promise<Movie[]> {
    return this.catalog.listMovies(regionId);
  }
  showtimes(query: { movieId: string; regionId?: string; cinemaId?: string }): Promise<Showtime[]> {
    return this.catalog.listShowtimes(query);
  }

  // Group a movie's showtimes by cinema, preserving first-seen order, times sorted.
  static byCinema(showtimes: Showtime[]): { cinemaId: string; name: string; showtimes: Showtime[] }[] {
    const order: string[] = [];
    const map = new Map<string, Showtime[]>();
    for (const st of showtimes) {
      if (!map.has(st.cinemaId)) {
        map.set(st.cinemaId, []);
        order.push(st.cinemaId);
      }
      map.get(st.cinemaId)!.push(st);
    }
    return order.map((id) => ({
      cinemaId: id,
      name: map.get(id)![0].cinemaName ?? id,
      showtimes: map.get(id)!.sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? ""))),
    }));
  }
}
