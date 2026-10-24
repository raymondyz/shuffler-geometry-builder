const PATHS = {
  play: 'M7 5l12 7-12 7z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13',
  plus: 'M12 5v14M5 12h14',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13',
  warning: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  error: 'M12 3a9 9 0 110 18 9 9 0 010-18zM9 9l6 6M15 9l-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  rotateLeft: 'M4 12a8 8 0 108-8 8.7 8.7 0 00-6 2.5L4 8.5M4 4v4.5h4.5',
  rotateRight: 'M20 12a8 8 0 11-8-8 8.7 8.7 0 016 2.5L20 8.5M20 4v4.5h-4.5',
} as const

export type IconName = keyof typeof PATHS

/** Minimal stroke icon set (24×24 grid). */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const filled = name === 'play' || name === 'pause'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={PATHS[name]}
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
