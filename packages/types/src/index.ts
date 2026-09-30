export * from './errors';
export const BAND_MIN = 0;
export const BAND_MAX = 9;
export const isValidBand = (b: number) => b >= BAND_MIN && b <= BAND_MAX && Number.isInteger(b * 2);
