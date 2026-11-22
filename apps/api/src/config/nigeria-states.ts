/**
 * Approximate centre of each Nigerian state (and the FCT). Used to place a buyer in a state from
 * their location for advert and featured-shop targeting; good enough for that, not for addresses.
 */
export const stateCentres: [state: string, lat: number, lng: number][] = [
  ['Abia', 5.45, 7.52],
  ['Adamawa', 9.33, 12.4],
  ['Akwa Ibom', 5.0, 7.85],
  ['Anambra', 6.21, 7.07],
  ['Bauchi', 10.31, 9.84],
  ['Bayelsa', 4.77, 6.07],
  ['Benue', 7.34, 8.74],
  ['Borno', 11.83, 13.15],
  ['Cross River', 5.87, 8.6],
  ['Delta', 5.7, 5.93],
  ['Ebonyi', 6.26, 8.01],
  ['Edo', 6.63, 5.93],
  ['Ekiti', 7.72, 5.31],
  ['Enugu', 6.54, 7.44],
  ['FCT', 9.06, 7.49],
  ['Gombe', 10.36, 11.19],
  ['Imo', 5.57, 7.06],
  ['Jigawa', 12.23, 9.56],
  ['Kaduna', 10.38, 7.71],
  ['Kano', 11.75, 8.52],
  ['Katsina', 12.38, 7.63],
  ['Kebbi', 11.49, 4.23],
  ['Kogi', 7.73, 6.69],
  ['Kwara', 8.97, 4.39],
  ['Lagos', 6.52, 3.38],
  ['Nasarawa', 8.54, 8.31],
  ['Niger', 9.93, 5.6],
  ['Ogun', 6.99, 3.47],
  ['Ondo', 7.1, 4.84],
  ['Osun', 7.56, 4.52],
  ['Oyo', 8.12, 3.42],
  ['Plateau', 9.22, 9.52],
  ['Rivers', 4.84, 6.91],
  ['Sokoto', 13.06, 5.24],
  ['Taraba', 7.87, 10.78],
  ['Yobe', 12.29, 11.44],
  ['Zamfara', 12.12, 6.22],
];

/** The state whose centre is nearest to a point (within Nigeria), or '' when far outside. */
export function stateAt(lat: number, lng: number) {
  let best = '',
    bestD = Infinity;
  for (const [state, a, b] of stateCentres) {
    const d = (a - lat) ** 2 + ((b - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) [best, bestD] = [state, d];
  }
  // About 3 degrees: further than that is outside Nigeria.
  return bestD < 9 ? best : '';
}
