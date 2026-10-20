import { useEffect } from 'react'
import { useDesignStore } from '../../state/designStore'
import { playheadActions } from '../../state/playhead'
import { useUiStore } from '../../state/uiStore'
import { isActivatable, isTextEntry } from './keyboard'


/** App-wide shortcuts: undo/redo, save and play/pause. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z') {
        if (isTextEntry(e.target)) return
        e.preventDefault()
        if (e.shiftKey) useDesignStore.getState().redo()
        else useDesignStore.getState().undo()
      } else if (mod && key === 's') {
        e.preventDefault()
        useUiStore.getState().openDialog('save')
      } else if (mod && key === 'y') {
        if (isTextEntry(e.target)) return
        e.preventDefault()
        useDesignStore.getState().redo()
      } else if (key === ' ' && !mod && !isTextEntry(e.target) && !isActivatable(e.target)) {
        e.preventDefault()
        playheadActions.toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
