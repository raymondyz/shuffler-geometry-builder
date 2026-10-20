import { createStore, useStore } from 'zustand'
import { TAU, wrapTau } from '../core/math/angle'

interface PlayheadState {
  /** Cam angle of foot 1, radians */
  phi: number
  playing: boolean
  /** Animation speed in cam revolutions per second */
  speed: number
}

/**
 * The shared cam angle every view follows. It lives in its own store so the 60 fps updates only
 * re-render components that subscribe to it.
 */
export const playheadStore = createStore<PlayheadState>()(() => ({
  phi: (3 * Math.PI) / 2,
  playing: false,
  speed: 0.25,
}))

export const usePlayhead = <T>(selector: (s: PlayheadState) => T): T => useStore(playheadStore, selector)

let frame = 0
let lastTime = 0

function tick(time: number) {
  const { playing, phi, speed } = playheadStore.getState()
  if (!playing) return
  const dt = lastTime ? Math.min(0.1, (time - lastTime) / 1000) : 0
  lastTime = time
  playheadStore.setState({ phi: wrapTau(phi + speed * TAU * dt) })
  frame = requestAnimationFrame(tick)
}

export const playheadActions = {
  setPhi(phi: number) {
    playheadStore.setState({ phi: wrapTau(phi) })
  },
  setSpeed(speed: number) {
    playheadStore.setState({ speed })
  },
  play() {
    if (playheadStore.getState().playing) return
    playheadStore.setState({ playing: true })
    lastTime = 0
    frame = requestAnimationFrame(tick)
  },
  pause() {
    playheadStore.setState({ playing: false })
    cancelAnimationFrame(frame)
  },
  toggle() {
    if (playheadStore.getState().playing) playheadActions.pause()
    else playheadActions.play()
  },
  /** Pause and jump: used when the user scrubs */
  scrubTo(phi: number) {
    playheadActions.pause()
    playheadActions.setPhi(phi)
  },
}
