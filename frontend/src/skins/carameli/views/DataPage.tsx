import { DataView } from '../../../components/DataView'
import type { DataPageProps } from '../../types'

// Functional placeholder — uses the shared generic renderer until the carameli
// skin gives this page a bespoke 3D treatment.
export default function DataPage(props: DataPageProps) {
  return <DataView {...props} />
}
