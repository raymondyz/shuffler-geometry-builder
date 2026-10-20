import { useAnalysis } from './state/useAnalysis'
import { useShortcuts } from './ui/hooks/useShortcuts'
import { AppShell } from './ui/layout/AppShell'

export default function App() {
  const analysis = useAnalysis()
  useShortcuts()
  return <AppShell analysis={analysis} />
}
