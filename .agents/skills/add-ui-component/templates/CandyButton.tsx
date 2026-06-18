/**
 * CandyButton — caramel pill button with squash-and-stretch spring physics.
 *
 * See .claude/rules/skin-carameli.md § Button Design and § Animation System.
 *
 * Usage:
 *   <CandyButton label="Call" onClick={handleCall} bobOffset={0.4} />
 *
 * Rules enforced here:
 *   - Press: Y scale → 0.82 (asymmetric squash — NOT uniform)
 *   - Hover: uniform scale lift to 1.04
 *   - Release: bouncy spring back (tension 600, friction 12)
 *   - Bob: sinusoidal Y at ~0.6 Hz via useFrame
 */
import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { useSpring, animated } from '@react-spring/three'
import * as THREE from 'three'
import { CARAMEL_GLOSS } from '../material-presets'

interface CandyButtonProps {
  label: string
  onClick?: () => void
  /** Phase offset for bob animation — stagger from sibling panels. */
  bobOffset?: number
  /** Override panel color (e.g. candy-pink accent). Defaults to CARAMEL_GLOSS color. */
  color?: string
}

export function CandyButton({ label, onClick, bobOffset = 0, color }: CandyButtonProps) {
  const [pressed, setPressed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const groupRef = useRef<THREE.Group>(null!)

  // Asymmetric squash-and-stretch — Y compresses, X/Z imply spread
  const { scale } = useSpring({
    scale: pressed
      ? ([1.08, 0.82, 1.08] as [number, number, number]) // squash on press
      : hovered
        ? ([1.04, 1.04, 1.04] as [number, number, number]) // uniform hover lift
        : ([1, 1, 1] as [number, number, number]),
    config: pressed
      ? { tension: 600, friction: 12 }  // snappy press
      : { tension: 200, friction: 20 }, // slow hover approach
  })

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() + bobOffset
    groupRef.current.position.y = Math.sin(t * 0.6) * 0.05
  })

  return (
    <group ref={groupRef}>
      <animated.group
        scale={scale}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => {
          setPressed(false)
          onClick?.()
        }}
        onPointerLeave={() => {
          setHovered(false)
          setPressed(false)
        }}
        onPointerEnter={() => setHovered(true)}
      >
        {/* Pill body */}
        <mesh>
          <capsuleGeometry args={[0.18, 0.8, 8, 24]} />
          <meshPhysicalMaterial {...CARAMEL_GLOSS} color={color ?? CARAMEL_GLOSS.color} />
        </mesh>

        {/* Flat billboard label — cream white, centered on pill face */}
        <Text
          position={[0, 0, 0.2]}
          fontSize={0.14}
          color="#FFFDF5"
          anchorX="center"
          anchorY="middle"
          // TODO: swap font to match heading font family if using a custom typeface
        >
          {label}
        </Text>
      </animated.group>
    </group>
  )
}
