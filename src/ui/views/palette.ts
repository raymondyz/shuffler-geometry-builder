// Categorical colours for feet, assigned in fixed order (validated palette, see index.css --series-*).
export const SERIES_COUNT = 8

export const footColor = (foot: number): string => `var(--series-${(foot % SERIES_COUNT) + 1})`

export const footLabel = (foot: number): string => `Foot ${foot + 1}`
