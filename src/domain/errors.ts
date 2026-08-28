// Domain errors — thrown by adapters and use cases, caught by the presentation layer.
// Each carries a stable `code` so callers branch on the type, not on message strings.
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthError extends DomainError {
  constructor(message = "credenciales inválidas") {
    super(message, "auth");
  }
}

export class NotAvailableError extends DomainError {
  constructor(message: string) {
    super(message, "not-available");
  }
}

// A chain that allows one active order per member (Royal Films, Cinemark) rejects a
// new purchase while a previous one is unpaid.
export class PendingOrderError extends DomainError {
  constructor(message = "ya tenés una compra pendiente sin pagar; esperá a que expire") {
    super(message, "pending-order");
  }
}

export class NotImplementedError extends DomainError {
  constructor(what: string) {
    super(`no implementado: ${what}`, "not-implemented");
  }
}
