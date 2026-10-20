import type { Analysis } from '../../core/analysis/analyze'
import { useUiStore } from '../../state/uiStore'
import { GeneratePanel } from '../generate/GeneratePanel'
import { IssuesSection } from '../panels/IssuesPanel'
import { MoreResultsSection, ResultsSection } from '../panels/MetricsPanel'
import { HardwareSection, MechanismSection } from '../panels/ParametersPanel'
import { ViewArea } from '../views/ViewArea'
import { Header } from './Header'
import styles from './layout.module.css'

/** Page layout: header, sidebar (inputs and results) and the view grid. */
export function AppShell({ analysis }: { analysis: Analysis }) {
  const mode = useUiStore((s) => s.mode)
  return (
    <div className={styles.shell}>
      <Header analysis={analysis} />
      <div className={styles.body}>
        {mode === 'generate' ? (
          <aside className={styles.sidebar} aria-label="Generator brief">
            <GeneratePanel />
          </aside>
        ) : (
          <aside className={styles.sidebar} aria-label="Parameters and results">
            <MechanismSection />
            <IssuesSection issues={analysis.issues} />
            <ResultsSection analysis={analysis} />
            <MoreResultsSection analysis={analysis} />
            <HardwareSection />
          </aside>
        )}
        <main className={styles.main}>
          {/* Keyed by mode so each area opens on its first tab after switching */}
          <ViewArea key={`primary-${mode}`} area="primary" analysis={analysis} className={styles.primary} />
          <ViewArea key={`secondary-${mode}`} area="secondary" analysis={analysis} className={styles.secondary} />
          <ViewArea key={`bottom-${mode}`} area="bottom" analysis={analysis} className={styles.bottom} />
        </main>
      </div>
    </div>
  )
}
