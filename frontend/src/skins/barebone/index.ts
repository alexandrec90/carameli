import type { Skin } from '../types'
import { Layout } from './Layout'
import Dashboard from './views/Dashboard'
import PhoneLines from './views/PhoneLines'
import Extensions from './views/Extensions'
import Softphone from './views/Softphone'
import Placeholder from './views/Placeholder'
import DataPage from './views/DataPage'

const skin: Skin = {
    Layout,
    views: { Dashboard, PhoneLines, Extensions, Softphone, Placeholder, DataPage },
}

export default skin
