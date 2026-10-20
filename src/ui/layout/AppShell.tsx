import type { Analysis } from '../../core/analysis/analyze'
import { IssuesSection } from '../panels/IssuesPanel'
import { MoreResultsSection, ResultsSection } from '../panels/MetricsPanel'
import { HardwareSection, MechanismSection } from '../panels/ParametersPanel'
import { ViewArea } from '../views/ViewArea'
import { Header } from './Header'
import styles from './layout.module.css'

/** Page layout: header, sidebar (inputs and results) and the view grid. */
export function AppShell({ analysis }: { analysis: Analysis }) {
  return (
    <div className={styles.shell}>
      <Header analysis={analysis} />
      <div className={styles.body}>
        <aside className={styles.sidebar} aria-label="Parameters and results">
          <MechanismSection />
          <IssuesSection issues={analysis.issues} />
          <ResultsSection analysis={analysis} />
          <MoreResultsSection analysis={analysis} />
          <HardwareSection />
        </aside>
        <main className={styles.main}>
          <ViewArea area="primary" analysis={analysis} className={styles.primary} />
          <ViewArea area="secondary" analysis={analysis} className={styles.secondary} />
          <ViewArea area="bottom" analysis={analysis} className={styles.bottom} />
        </main>
      </div>
    </div>
  )
}
