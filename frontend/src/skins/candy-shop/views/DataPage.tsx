import { DataView } from '../../../components/DataView'
import type { DataPageProps } from '../../types'

// Functional placeholder — uses the shared generic renderer until the candy-shop
// skin gives this page bespoke gloss treatment.
export default function DataPage(props: DataPageProps) {
  return <DataView {...props} />
}
