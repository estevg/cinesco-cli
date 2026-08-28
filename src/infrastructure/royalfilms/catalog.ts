// Royal Films CatalogPort — bespoke JWT API, all reads headless. Envelope {status,data}.
import type { CatalogPort } from "../../domain/ports.ts";
import type { Region, Cinema, Movie, Showtime } from "../../domain/entities.ts";
import { DomainError } from "../../domain/errors.ts";
import { funcTime, type FunctionCell } from "./wizard.ts";

const BASE = "https://cinemasroyalfilms.com/api";
type Row = Record<string, any>;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: "application/json", "User-Agent": "cinesco-cli/0.1.0" } });
  const body = (await res.json()) as { status: boolean; data?: T; message?: string };
  if (body.status === false) throw new DomainError(body.message || `error en ${path}`, "http");
  return (body.data as T) ?? ([] as unknown as T);
}

export const royalfilmsCatalog: CatalogPort = {
  async listRegions(): Promise<Region[]> {
    return (await get<Row[]>(`/cities`)).map((c) => ({ id: String(c.ciudad_id), name: String(c.ciudad_nombre) }));
  },
  async listCinemas(regionId?: string): Promise<Cinema[]> {
    if (!regionId) throw new Error("Royal Films necesita una ciudad (region).");
    return (await get<Row[]>(`/cinemas/city/${regionId}`)).map((c) => ({ id: String(c.multicine_id), name: String(c.multicine_nombre), regionId }));
  },
  async listMovies(regionId?: string): Promise<Movie[]> {
    if (!regionId) throw new Error("Royal Films necesita una ciudad (region).");
    return (await get<Row[]>(`/billboard/city/${regionId}`)).map((b) => {
      const p = (b.pelicula ?? {}) as Row;
      return { id: String(p.pelicula_id), title: String(p.pelicula_nombre_formato) };
    });
  },
  async listShowtimes({ movieId, regionId }): Promise<Showtime[]> {
    if (!regionId) throw new Error("Royal Films necesita una ciudad (region).");
    return (await get<FunctionCell[]>(`/movies/functions/${movieId}/city/${regionId}`)).map((f) => ({
      id: String(f.funcion_id), date: String(f.funcion_fecha), time: funcTime(f), cinemaId: String(f.funcion_multicine_id),
      cinemaName: f.multicine?.multicine_nombre ? String(f.multicine.multicine_nombre) : undefined,
      movieId, hall: f.funcion_sala_id != null ? String(f.funcion_sala_id) : undefined,
      format: [f.formato?.formato_nombre, f.version?.version_nombre].filter(Boolean).join(" ") || undefined,
    }));
  },
};
