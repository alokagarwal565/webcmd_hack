// server/adapters/booking/index.js — the BookingProvider registry, same
// name-resolved-at-runtime pattern as the LLM registry (§13.1/§13.2 for the
// LLM case; applied here to the booking seam). BOOKING_PROVIDER=fixture
// selects the offline adapter (§27.3) without any code change.
import { config } from '../../config.js';
import { createDistrictAdapter } from './district.js';
import { createFixtureAdapter } from './fixture.js';

const factories = new Map([
  ['district', createDistrictAdapter],
  ['fixture', createFixtureAdapter],
]);

const instances = new Map();

function build(name) {
  const factory = factories.get(name);
  if (!factory) {
    throw new Error(
      `[booking] Unknown booking provider: "${name}". Known providers: ${[...factories.keys()].join(', ')}`
    );
  }
  if (!instances.has(name)) instances.set(name, factory());
  return instances.get(name);
}

/** Resolve a booking provider by name. Throws synchronously if unknown. */
export function getProvider(name) {
  return build(name);
}

/** The configured booking provider (BOOKING_PROVIDER). */
export function getBookingProvider() {
  return build(config.BOOKING_PROVIDER);
}
