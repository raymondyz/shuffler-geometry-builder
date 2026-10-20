import { useId, useState } from 'react'
import { DESIGN_FILE_EXTENSION } from '../../core/design/serialize'
import { useDesignStore } from '../../state/designStore'
import { useUiStore } from '../../state/uiStore'
import { Button } from '../common/Button'
import { Dialog } from '../common/Dialog'
import controls from '../common/controls.module.css'
import { fileBaseName, saveDesign } from './fileActions'

/** Asks for a name, then saves the design under it. Rendered only while open. */
export function SaveDialog() {
  const id = useId()
  const currentName = useDesignStore((s) => s.design.name)
  const close = useUiStore((s) => s.closeDialog)
  const [name, setName] = useState(currentName)
  return (
    <Dialog
      title="Save design"
      onClose={close}
      onSubmit={() => {
        saveDesign(name)
        close()
      }}
      actions={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit">Save</Button>
        </>
      }
    >
      <label className={controls.dialogLabel} htmlFor={id}>
        Name
      </label>
      <input
        id={id}
        className={controls.textInput}
        value={name}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setName(e.target.value)}
      />
      <p className={controls.dialogHint}>
        Saves “{fileBaseName(name)}{DESIGN_FILE_EXTENSION}”. Exports use the same name.
      </p>
    </Dialog>
  )
}
