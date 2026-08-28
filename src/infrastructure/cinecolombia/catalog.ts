// Cine Colombia CatalogPort — Vista OCAPI browse (headless with the app bearer token).
// Delegates to the existing cinecolombia module and maps its shapes onto the domain.
// Login/purchase are browser-assisted and handled by the presentation layer.
import type { CatalogPort } from "../../domain/ports.ts";
import type { Region, Cinema, Movie, Showtime } from "../../domain/entities.ts";
import { cinecolombia as legacy } from "./cinecolombia.ts";

export const cinecolombiaCatalog: CatalogPort = {
  listRegions: legacy.listRegions
    ? async () => (await legacy.listRegions!()).map((r) => ({ id: r.id, name: r.name }))
    : undefined,
  async listCinemas(regionId?: string): Promise<Cinema[]> {
    return (await legacy.listCinemas(regionId)).map((c) => ({ id: c.id, name: c.name, regionId: (c as { region?: string }).region }));
  },
  async listMovies(regionId?: string): Promise<Movie[]> {
    return (await legacy.listMovies(regionId)).map((m) => ({ id: m.id, title: m.title }));
  },
  async listShowtimes(q): Promise<Showtime[]> {
    const sts = await legacy.listShowtimes({ movieId: q.movieId, region: q.regionId, cinemaId: q.cinemaId });
    return sts.map((s) => ({ id: s.id, date: s.date, time: s.time, cinemaId: s.cinemaId, cinemaName: s.cinemaName, movieId: s.movieId, hall: s.hall, format: s.format }));
  },
};
