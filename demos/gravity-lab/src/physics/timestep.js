/** Every backend commits complete KDK steps of this duration. */
export const FIXED_TIMESTEP = 1 / 60;

export function wholeStepCount(duration, step = FIXED_TIMESTEP) {
  const count = duration / step;
  // Correct only floating-point roundoff at whole-step boundaries.
  return Math.floor(count + 8 * Number.EPSILON * Math.max(1, count));
}
