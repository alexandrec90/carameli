/**
 * Carameli skin — canonical material presets.
 *
 * Source of truth: .claude/rules/skin-carameli.md § Materials Spec
 *
 * Usage — spread into <meshPhysicalMaterial />:
 *
 *   import { CARAMEL_GLOSS } from '.claude/skills/add-ui-component/material-presets'
 *   <meshPhysicalMaterial {...CARAMEL_GLOSS} />
 *
 * Or copy-paste individual objects into JSX props directly.
 *
 * ⚠️  Never use meshStandardMaterial or meshBasicMaterial on primary surfaces.
 */

/** Panel surface — golden amber gloss with translucent candy shell. */
export const CARAMEL_GLOSS = {
  color: '#FF9F1C',
  roughness: 0.05,       // near-mirror gloss
  metalness: 0,
  transmission: 0.15,    // slight internal glow / translucency
  thickness: 1.2,        // IOR refraction depth
  ior: 1.52,             // glass-like refractive index
  reflectivity: 0.9,
  clearcoat: 1,          // candy shell clear coat
  clearcoatRoughness: 0.02,
  envMapIntensity: 2.5,  // HDR reflection strength
  sheen: 0.4,
  sheenColor: '#FFD275', // satin sheen on curved edges
} as const

/** 3D text / headline mesh — cream-white coating with strong reflections. */
export const CREAM_COAT = {
  color: '#FFFDF5',
  roughness: 0.08,
  metalness: 0,
  transmission: 0.08,
  thickness: 0.4,
  clearcoat: 1,
  clearcoatRoughness: 0.01,
  envMapIntensity: 3.0,  // white surfaces pick up HDR strongly
} as const

/** Drip geometry — darker caramel, semi-translucent. */
export const MOLTEN_DRIP = {
  color: '#C8640A',
  roughness: 0.12,
  metalness: 0,
  transmission: 0.25,    // drips are semi-translucent
  thickness: 0.8,
  ior: 1.46,
  clearcoat: 0.8,
  clearcoatRoughness: 0.05,
} as const

/** Candy-pink accent — badge dots, notification jewels, highlight details. */
export const CANDY_ACCENT = {
  color: '#FF6B9D',
  roughness: 0.04,
  metalness: 0,
  clearcoat: 1,
  clearcoatRoughness: 0.01,
  envMapIntensity: 3.0,
} as const
