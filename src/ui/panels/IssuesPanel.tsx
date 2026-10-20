import type { Issue } from '../../core/design/validate'
import { Icon } from '../common/Icon'
import { Section } from '../common/Section'
import styles from './panels.module.css'

/** Errors and warnings, errors first. Hidden when there is nothing to report. */
export function IssuesSection({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null
  const sorted = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
  const errors = issues.filter((i) => i.level === 'error').length
  return (
    <Section title="Issues" aside={errors > 0 ? `${errors} error${errors > 1 ? 's' : ''}` : `${issues.length} warning${issues.length > 1 ? 's' : ''}`}>
      <ul className={styles.issues}>
        {sorted.map((issue) => (
          <li key={issue.code} className={issue.level === 'error' ? styles.error : styles.warning}>
            <Icon name={issue.level === 'error' ? 'error' : 'warning'} />
            <span>
              <strong>{issue.level === 'error' ? 'Error' : 'Warning'}:</strong> {issue.message}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}
