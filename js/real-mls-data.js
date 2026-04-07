// FBref-only real MLS dataset.
// This file is intentionally empty until you build it from FBref 2025 + 2026 MLS exports.
// Run: python scripts/build_real_mls_from_fbref.py --fbref-2025 <file> --fbref-2026 <file> --out js/real-mls-data.js
export const REAL_MLS_DATA_META = {
  source: 'fbref-only',
  ready: false,
  seasons: [2025, 2026],
  builtAt: null,
  playerCount: 0,
  note: 'No FBref-derived real-player dataset is bundled in this build yet.'
};

export const REAL_MLS_PLAYERS = [];
