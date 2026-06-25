import { DataView } from '../../../components/DataView'
import type { DataPageProps } from '../../types'

// Functional placeholder — uses the shared generic renderer until the comic-book
// skin gives this page bespoke panel treatment.
export default function DataPage(props: DataPageProps) {
  return <DataView {...props} />
}
