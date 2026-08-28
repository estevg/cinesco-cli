import { apiPost, apiDelete } from "./api.ts";

// Observed body of POST /reserve/ticket-office (verified live 2026-08-23).
export interface ReserveBody {
  reserva_silla_funcion: number;
  reserva_silla_multicine: number;
  reserva_silla_sala: number;
  sillas_reservadas_id: string; // comma-joined silla_id
  sillas_reservadas_numero: string; // comma-joined seat labels
  auto_assign_by_type: boolean;
  chair_type_quantities: unknown[];
}

// Observed response: data.reserve.reserva_silla_id is the hold id (used for release).
export interface ReserveResult {
  message?: string;
  reserve: {
    reserva_silla_id: number;
    reserva_silla_funcion: number;
    reserva_silla_multicine: number;
    reserva_silla_sala: number;
    sillas_reservadas_id: string;
    sillas_reservadas_numero: string;
    reserva_silla_fecha_hora: string;
    reserva_silla_estado: number;
  };
  assigned_chairs?: unknown[];
}

export function buildReserveBody(
  funcion: number,
  multicine: number,
  sala: number,
  seats: { id: number; numero: string }[],
): ReserveBody {
  return {
    reserva_silla_funcion: funcion,
    reserva_silla_multicine: multicine,
    reserva_silla_sala: sala,
    sillas_reservadas_id: seats.map((s) => s.id).join(),
    sillas_reservadas_numero: seats.map((s) => s.numero).join(),
    auto_assign_by_type: false,
    chair_type_quantities: [],
  };
}

export function reserve(body: ReserveBody, token: string): Promise<ReserveResult> {
  return apiPost<ReserveResult>(`/reserve/ticket-office`, body, token);
}

export function releaseReserve(reservaId: number, token: string): Promise<unknown> {
  return apiDelete(`/reserve/ticket-office/${reservaId}`, token);
}
