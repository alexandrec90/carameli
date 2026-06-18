/**
 * CandyHeadline — extruded 3D script heading with cream-coat material.
 *
 * Use for page titles, section headings, and logo text.
 * Rules enforced here:
 *   - Text3D with bevelEnabled (rule: no flat text headings)
 *   - height ≥ 0.2 (depth), bevelThickness ≥ 0.04
 *   - Cream Coat material: near-white, high clearcoat, high envMapIntensity
 *   - Centered via <Center> wrapper
 *
 * Usage:
 *   <CandyHeadline text="Dashboard" />
 */
import { Center, Text3D } from '@react-three/drei'
import { CREAM_COAT } from '../material-presets'

interface CandyHeadlineProps {
  text: string
  /** Font size in world units. Default 0.8. */
  size?: number
}

export function CandyHeadline({ text, size = 0.8 }: CandyHeadlineProps) {
  return (
    <Center>
      <Text3D
        font="/fonts/Pacifico_Regular.json"
        size={size}
        height={0.28}
        curveSegments={32}
        bevelEnabled
        bevelThickness={0.06}
        bevelSize={0.04}
        bevelSegments={12}
      >
        {text}
        <meshPhysicalMaterial {...CREAM_COAT} />
      </Text3D>
    </Center>
  )
}
