/**
 * CandyTile — floating candy panel with bob animation and dripping edges.
 *
 * Use as the wrapper for every data card / stat / widget in the Carameli skin.
 * See .claude/rules/skin-carameli.md § Panel Geometry for constraints.
 *
 * Usage:
 *   <CandyTile width={3.2} height={2.0} bobOffset={0}>
 *     {/* content at z=0.14, in front of panel face *\/}
 *   </CandyTile>
 *
 * Stagger bobOffset across sibling tiles: 0, 0.8, 1.7, 2.5 …
 */
import { useRef } from 'react'
import type React from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { CARAMEL_GLOSS } from '../material-presets'
import { DrippingEdge } from './DrippingEdge'

interface CandyTileProps {
  children?: React.ReactNode
  width?: number
  height?: number
  /** Phase offset for bob animation — stagger siblings to avoid unison movement. */
  bobOffset?: number
  /** Number of drips along the bottom edge (4–8). */
  dripCount?: number
}

export function CandyTile({
  children,
  width = 3.2,
  height = 2.0,
  bobOffset = 0,
  dripCount = 6,
}: CandyTileProps) {
  const groupRef = useRef<THREE.Group>(null!)

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() + bobOffset
    // Bob: slow sine at ~0.6 Hz, low amplitude
    groupRef.current.position.y = Math.sin(t * 0.6) * 0.06
    // Slight rock — < 0.015 rad amplitude
    groupRef.current.rotation.z = Math.sin(t * 0.4 + 1.2) * 0.012
  })

  return (
    <group ref={groupRef}>
      {/* Panel body — depth ≥ 0.18, radius ≥ 0.14 (rule) */}
      <RoundedBox args={[width, height, 0.22]} radius={0.18} smoothness={8}>
        <meshPhysicalMaterial {...CARAMEL_GLOSS} />
      </RoundedBox>

      {/* Drips hang from the bottom edge */}
      <DrippingEdge panelWidth={width} panelBottom={-height / 2} dripCount={dripCount} />

      {/* Content sits just in front of the panel face */}
      <group position={[0, 0, 0.14]}>{children}</group>
    </group>
  )
}
