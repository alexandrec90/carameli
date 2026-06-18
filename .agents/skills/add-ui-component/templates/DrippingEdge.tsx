/**
 * DrippingEdge — procedural caramel drips along the bottom of any panel.
 *
 * Required child of every CandyTile / panel component.
 * Rule: 4–8 drips per panel (dripCount). Vary length per drip.
 *
 * Usage:
 *   <DrippingEdge panelWidth={3.2} panelBottom={-1.0} />
 *
 * panelBottom = -(panelHeight / 2)
 */
import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MOLTEN_DRIP } from '../material-presets'

interface DrippingEdgeProps {
  panelWidth: number
  panelBottom: number
  /** Number of drip capsules. Clamped to 4–8. Default 6. */
  dripCount?: number
}

interface DripConfig {
  x: number
  length: number
  phase: number
}

export function DrippingEdge({ panelWidth, panelBottom, dripCount = 6 }: DrippingEdgeProps) {
  const count = Math.min(8, Math.max(4, dripCount))
  const groupRef = useRef<THREE.Group>(null!)

  // Stable drip config — memoised so random lengths don't re-roll on every render.
  const drips = useMemo<DripConfig[]>(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: -panelWidth / 2 + 0.3 + (i / (count - 1)) * (panelWidth - 0.6),
        length: 0.15 + Math.random() * 0.3,
        phase: i * 1.1,
      })),
    [panelWidth, count],
  )

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    groupRef.current.children.forEach((drip, i) => {
      drip.rotation.z = Math.sin(t * 0.3 + drips[i].phase) * 0.08   // slow pendulum
      drip.scale.y = 1 + Math.sin(t * 0.5 + drips[i].phase) * 0.04  // slight elongation pulse
    })
  })

  return (
    <group ref={groupRef}>
      {drips.map((d, i) => (
        <mesh key={i} position={[d.x, panelBottom - d.length / 2, 0]}>
          <capsuleGeometry args={[0.04, d.length, 6, 12]} />
          <meshPhysicalMaterial {...MOLTEN_DRIP} />
        </mesh>
      ))}
    </group>
  )
}
