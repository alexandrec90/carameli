import type { Skin } from '../types'
import { Layout } from './Layout'
import Dashboard from './views/Dashboard'
import PhoneLines from './views/PhoneLines'
import Extensions from './views/Extensions'
import Placeholder from './views/Placeholder'

const skin: Skin = {
    Layout,
    views: { Dashboard, PhoneLines, Extensions, Placeholder },
}

export default skin
