export class DiscoveryError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export class MovieSourceUnavailableError extends DiscoveryError {
  constructor() { super("The movie service is temporarily unavailable. Please try again.", 503) }
}
