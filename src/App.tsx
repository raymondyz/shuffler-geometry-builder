import { useLayoutEffect } from 'react'
import { useAnalysis } from './state/useAnalysis'
import { useUiStore } from './state/uiStore'
import { useShortcuts } from './ui/hooks/useShortcuts'
import { AppShell } from './ui/layout/AppShell'
import { applyTheme } from './ui/theme'

export default function App() {
  const analysis = useAnalysis()
  const theme = useUiStore((s) => s.theme)
  useLayoutEffect(() => applyTheme(theme), [theme])
  useShortcuts()
  return <AppShell analysis={analysis} />
}
