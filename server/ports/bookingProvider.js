// server/ports/bookingProvider.js — the ONLY booking-site surface business
// logic may import (§8.2, §13.1-style port). Adapters (server/adapters/booking/*)
// implement this shape; recommendationService imports the registry in
// server/adapters/booking/index.js, never a concrete adapter.

/**
 * @typedef {Object} BookingOption
 * @property {string} externalId
 * @property {string} title
 * @property {string} venue
 * @property {string|null} showTime   ISO 8601, if known
 * @property {number|null} price
 * @property {object} raw             The provider's full response for this option — retained so a re-ranking never needs a second network call (§10.2).
 *
 * @typedef {Object} ConstraintSet
 * @property {number} party_size
 * @property {number|null} max_price_per_seat
 * @property {string|null} seat_class
 * @property {boolean} seats_together
 * @property {string|null} location
 * @property {{start: string, end: string}[]} preferred_time_windows
 * @property {string[]} content_preferences
 *
 * @typedef {Object} BookingProvider
 * @property {string} name
 * @property {(constraintSet: ConstraintSet) => Promise<BookingOption[]>} searchOptions
 */

export {};
