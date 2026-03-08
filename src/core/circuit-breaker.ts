export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
}

export class CircuitBreakerError extends Error {
  constructor(
    public readonly circuitName: string,
    public readonly state: CircuitState,
    public readonly resetAt?: Date
  ) {
    const resetMsg = resetAt
      ? ` (resets at ${resetAt.toISOString()})`
      : "";
    super(
      `Circuit breaker '${circuitName}' is ${state}${resetMsg}. Fast-failing to prevent cascading failures.`
    );
    this.name = "CircuitBreakerError";
  }
}

/**
 * CircuitBreaker implements the circuit breaker pattern to prevent cascading failures.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Too many failures, requests fail fast without calling the operation
 * - HALF_OPEN: Testing if the service has recovered, allows one request through
 *
 * Transitions:
 * - CLOSED -> OPEN: After failureThreshold consecutive failures
 * - OPEN -> HALF_OPEN: After resetTimeout milliseconds
 * - HALF_OPEN -> CLOSED: If test request succeeds
 * - HALF_OPEN -> OPEN: If test request fails
 *
 * Example:
 *   const breaker = new CircuitBreaker('api', { failureThreshold: 5, resetTimeout: 30000 });
 *   const result = await breaker.execute(() => fetch('https://api.example.com'));
 */
export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private nextAttempt: number = 0;
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;

  constructor(name: string, config: CircuitBreakerConfig) {
    this.name = name;
    this.failureThreshold = config.failureThreshold;
    this.resetTimeout = config.resetTimeout;
  }

  /**
   * Execute an operation through the circuit breaker.
   *
   * @param operation - Async function to execute
   * @returns Result of the operation
   * @throws CircuitBreakerError if circuit is OPEN
   * @throws Original error if operation fails
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check if we should transition from OPEN to HALF_OPEN
    if (this.state === "OPEN") {
      if (Date.now() >= this.nextAttempt) {
        this.state = "HALF_OPEN";
      } else {
        throw new CircuitBreakerError(
          this.name,
          this.state,
          new Date(this.nextAttempt)
        );
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful operation.
   */
  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === "HALF_OPEN") {
      this.state = "CLOSED";
    }
  }

  /**
   * Handle failed operation.
   */
  private onFailure(): void {
    this.failureCount++;

    if (this.state === "HALF_OPEN") {
      // If test request fails in HALF_OPEN, go back to OPEN
      this.trip();
    } else if (this.failureCount >= this.failureThreshold) {
      // If we've hit the failure threshold in CLOSED, trip the breaker
      this.trip();
    }
  }

  /**
   * Trip the circuit breaker to OPEN state.
   */
  private trip(): void {
    this.state = "OPEN";
    this.nextAttempt = Date.now() + this.resetTimeout;
  }

  /**
   * Get the current state of the circuit breaker.
   */
  getState(): CircuitState {
    // Update state if we're past the reset timeout
    if (this.state === "OPEN" && Date.now() >= this.nextAttempt) {
      return "HALF_OPEN";
    }
    return this.state;
  }

  /**
   * Get the current failure count.
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Get the next attempt time (for OPEN state).
   */
  getNextAttempt(): Date | null {
    if (this.state === "OPEN") {
      return new Date(this.nextAttempt);
    }
    return null;
  }

  /**
   * Reset the circuit breaker to CLOSED state.
   * Useful for testing or manual recovery.
   */
  reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.nextAttempt = 0;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): Readonly<CircuitBreakerConfig> {
    return {
      failureThreshold: this.failureThreshold,
      resetTimeout: this.resetTimeout,
    };
  }
}
