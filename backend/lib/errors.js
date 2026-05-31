// One small error type for the whole backend. Carries a stable machine `code`
// (sent across the native-messaging boundary so the side panel can branch on it)
// plus the optional `meta`/`available` fields the transcript path attaches, and a
// proper `cause` chain. Setting `this.name = this.constructor.name` makes stack
// traces and logs say "DistillerError" instead of a bare "Error".

export class DistillerError extends Error {
  /**
   * @param {string} message
   * @param {{code?: string, cause?: unknown, meta?: object, available?: string[]}} [opts]
   */
  constructor(message, { code = "ERROR", cause, meta, available } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = this.constructor.name;
    this.code = code;
    if (meta !== undefined) this.meta = meta;
    if (available !== undefined) this.available = available;
  }
}
