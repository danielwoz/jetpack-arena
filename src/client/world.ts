import { World } from '../shared/world.ts';

// The client's copy of dynamic world state (blast craters). Seeded from the
// welcome message and kept in sync by 'boom' events; used by prediction,
// cosmetic tracers, and rendering.
export const world = new World();
