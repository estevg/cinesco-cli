// Resolve a natural Spanish date keyword to YYYY-MM-DD. Returns null if unrecognised.
// `today` is injectable for testing. Weekday = the upcoming one (today if it matches).
const WEEKDAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function resolveDate(keyword: string, today: Date = new Date()): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(keyword.trim())) return keyword.trim();
  const k = norm(keyword);
  if (k === "hoy") return fmt(today);
  if (k === "manana") return fmt(addDays(today, 1));
  if (k === "pasado" || k === "pasado manana" || k === "pasadomanana") return fmt(addDays(today, 2));
  if (k in WEEKDAYS) return fmt(addDays(today, (WEEKDAYS[k] - today.getDay() + 7) % 7));
  return null;
}
