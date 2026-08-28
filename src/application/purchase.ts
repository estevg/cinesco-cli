// Purchase use case — orchestrates a PurchasePort: log in, read seats/fares, then
// checkout (reserve the chosen seats → generate the payment link). The CLI never
// charges; checkout stops at the link.
import type { PurchasePort } from "../domain/ports.ts";
import type {
  Session, Showtime, SeatMap, Fare, Seat, Movie, Order, PaymentLink, PaymentMethod,
} from "../domain/entities.ts";

export class PurchaseTickets {
  constructor(private readonly port: PurchasePort) {}

  login(credentials: { email: string; password: string }): Promise<Session> {
    return this.port.login(credentials);
  }
  // Reuse a session saved by a prior `login`, when the port supports it.
  restore(): Promise<Session | null> {
    return this.port.restore ? this.port.restore() : Promise.resolve(null);
  }
  seatMap(showtime: Showtime, session: Session): Promise<SeatMap> {
    return this.port.getSeatMap(showtime, session);
  }
  fares(showtime: Showtime, session: Session): Promise<Fare[]> {
    return this.port.listFares(showtime, session);
  }
  paymentMethods(): PaymentMethod[] {
    return this.port.paymentMethods();
  }

  // Reserve the seats, then generate the payment link.
  async checkout(input: {
    session: Session;
    showtime: Showtime;
    movie: Movie;
    regionId?: string;
    seats: Seat[];
    fare?: Fare;
    method?: PaymentMethod;
  }): Promise<{ order: Order; link: PaymentLink }> {
    const order = await this.port.reserve({
      session: input.session,
      showtime: input.showtime,
      movie: input.movie,
      regionId: input.regionId,
      seats: input.seats,
      fare: input.fare,
    });
    const link = await this.port.pay({
      session: input.session,
      order,
      showtime: input.showtime,
      movie: input.movie,
      seats: input.seats,
      method: input.method,
    });
    return { order, link };
  }
}
