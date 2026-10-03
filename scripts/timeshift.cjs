/**
 * Runs the rest of the process as though it were a different day.
 *
 * Preloaded with `node --require`. Shifts the clock forward by SHIFT_DAYS so a
 * suite can be run against a future date without waiting for one.
 *
 * This exists because of a test that asserted `/Sep|week/i` on the board
 * heading. It passed every day it was ever run and failed on the 1st of
 * October against a heading that was exactly right — the kind of fault that
 * cannot be found by running the suite, only by running it on the wrong day.
 * A green suite that is green because of today's date is not evidence.
 *
 * Shifts rather than pins, so relative logic still behaves: a row dated "three
 * days out" is still three days out, and only the absolute calendar moves.
 */

const DAYS = Number(process.env.SHIFT_DAYS ?? 0);
if (DAYS) {
  const offset = DAYS * 86_400_000;
  const RealDate = Date;

  /* Subclassing rather than patching now(), so `new Date()` with no arguments
     moves too — that is the form almost everything actually uses. Every other
     constructor signature has to keep working untouched, or the shift becomes
     a second source of failures and the run proves nothing. */
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  ShiftedDate.prototype = RealDate.prototype;
  globalThis.Date = ShiftedDate;
}
