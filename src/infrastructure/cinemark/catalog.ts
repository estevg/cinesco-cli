// Cinemark CatalogPort — maps the Vista/billboard API onto domain entities.
// Ids: region = CitySlug, cinema = CinemaId, movie = CorporateFilmId (the numeric id
// the showtimes endpoint wants — NOT ScheduledFilmId), showtime = SessionId.
import type { CatalogPort } from "../../domain/ports.ts";
import type { Region, Cinema, Movie, Showtime } from "../../domain/entities.ts";
import { coreGet, vista, CO } from "./client.ts";

type Row = Record<string, any>;
interface CityRow { Name: string; CitySlug: string; Theaters: Row[] }

function cities(): Promise<CityRow[]> {
  const sel = "ID,Name,PhoneNumber,Address1,Address2,Latitude,Longitude,City,LoyaltyCode";
  return coreGet<CityRow[]>(vista(`/cities-theaters?$format=json&$select=${sel}`));
}

export const cinemarkCatalog: CatalogPort = {
  async listRegions(): Promise<Region[]> {
    return (await cities()).map((c) => ({ id: c.CitySlug, name: c.Name }));
  },

  async listCinemas(regionId?: string): Promise<Cinema[]> {
    const cs = await cities();
    const pick = regionId ? cs.filter((c) => c.CitySlug === regionId) : cs;
    return pick.flatMap((c) =>
      (c.Theaters ?? []).map((t) => ({
        id: String(t.CinemaId ?? t.ID),
        name: String(t.Name),
        regionId: c.CitySlug,
        address: t.Address1 ? String(t.Address1) : undefined,
        city: t.City ? String(t.City) : c.Name,
      })),
    );
  },

  async listMovies(regionId?: string): Promise<Movie[]> {
    if (!regionId) throw new Error("Cinemark necesita una ciudad (region).");
    const bb = await coreGet<Row>(vista(`/city/${regionId}/movies-billboard-city?companyId=${CO.companyId}`));
    const seen = new Set<string>();
    const out: Movie[] = [];
    for (const cat of ["PremieresBillboard", "Presales"]) {
      for (const m of (bb[cat] ?? []) as Row[]) {
        const id = String(m.CorporateFilmId ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, title: String(m.PrettyTitle || m.TitleAlt || m.Title || id), rating: m.RatingAlt || m.Rating || undefined });
      }
    }
    return out;
  },

  async listShowtimes({ movieId, regionId, cinemaId }): Promise<Showtime[]> {
    if (!regionId) throw new Error("Cinemark necesita una ciudad (region).");
    let dates: string[] = [];
    try {
      const ds = await coreGet<Row>(
        vista(`/city/${regionId}/dates-session/${movieId}?openingDate=2020-01-01T00:00:00` +
          `&midnightSessionStart=${CO.midnightStart}&midnightSessionEnd=${CO.midnightEnd}`),
      );
      dates = ((ds?.Dates ?? ds ?? []) as Row[])
        .map((d) => String((d as any).Date ?? d).slice(0, 10))
        .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    } catch {
      /* fall back to today */
    }
    if (!dates.length) dates = [new Date().toISOString().slice(0, 10)];
    dates = [...new Set(dates)].slice(0, 14);

    const out: Showtime[] = [];
    for (const date of dates) {
      const data = await coreGet<Row>(
        vista(`/city/${regionId}/movie/${movieId}?date=${date}&companyId=${CO.companyId}` +
          `&midnightSessionStart=${CO.midnightStart}&midnightSessionEnd=${CO.midnightEnd}`),
      );
      for (const th of (data?.Theater ?? []) as Row[]) {
        if (cinemaId && String(th.CinemaId) !== String(cinemaId)) continue;
        for (const fmt of (th.Format ?? []) as Row[]) {
          const format = [fmt.ScreenTypes, fmt.LangTypes].flat().filter(Boolean).join(" ");
          for (const s of (fmt.Sessions ?? []) as Row[]) {
            if (s.IsVisible === false) continue;
            out.push({
              id: String(s.SessionId),
              date,
              time: String(s.Showtime ?? "").slice(0, 5) || undefined,
              cinemaId: String(th.CinemaId),
              cinemaName: String(th.Name ?? ""),
              movieId: String(movieId),
              hall: s.ScreenNumber != null ? String(s.ScreenNumber) : undefined,
              format: format || undefined,
            });
          }
        }
      }
    }
    return out;
  },
};
