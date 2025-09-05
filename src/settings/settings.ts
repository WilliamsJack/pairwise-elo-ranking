export interface EloSettings {
  kFactor: number;
  showToasts: boolean;
}

export const DEFAULT_SETTINGS: EloSettings = {
  kFactor: 24,
  showToasts: true,
};
