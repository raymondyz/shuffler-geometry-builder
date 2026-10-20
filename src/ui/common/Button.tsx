import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import styles from './controls.module.css'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost'
  icon?: IconName
  children?: ReactNode
}

export function Button({ variant = 'default', icon, children, className, type = 'button', ...rest }: ButtonProps) {
  const classes = [styles.button, variant !== 'default' ? styles[variant] : '', !children ? styles.iconOnly : '', className ?? '']
  return (
    <button type={type} className={classes.filter(Boolean).join(' ')} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  )
}
