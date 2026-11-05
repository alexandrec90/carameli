import { describe, expect, it } from 'vitest'

import { BUBBLE_VIEW, ELLIPSE, tailTip } from '../../skins/comic-book/bubbleBox'
import { splitAt } from '../../skins/comic-book/callSceneGeometry'
import type { SceneHalf } from '../../skins/comic-book/callSceneGeometry'
import { halfFor } from '../../skins/comic-book/callSceneRoles'
import {
  PANEL_BUBBLE_TRANSFORMS,
  PANEL_CALL_SCENES,
  PANEL_GRIDS,
  PANEL_IMG_TRANSFORMS,
} from '../../skins/comic-book/editor/layoutConfig'
import { bubbleRect, imgFrameBox, renderedImgRect } from '../../skins/comic-book/editor/transforms'
import type { BubbleTransform, CallRole, ImgTransform } from '../../skins/comic-book/editor/types'
import { frameRect, gridPolys } from '../../skins/comic-book/panelGeometry'

/**
 * The shipped phone call, checked against the drawings it is framed on.
 *
 * Nothing about a call's framing can be seen by a type or a render test: every number is
 * a percentage, and a tail is a fixed reach in one of eight directions, so "the balloon
 * speaks for this person" holds only because a figure and a balloon were placed for each
 * other. Move either in the editor and the tail points at nothing, with nothing failing.
 *
 * So the tail's tip and the balloon's ellipse are carried through the renderer's own
 * geometry into the art's pixels and compared with landmarks measured off the drawings.
 * Only the landscape page is held to this. On square and portrait the home grid cuts
 * panel 9 tall and narrow, so a half is too slim to hold this composition at all.
 *
 * If the art is replaced, re-measure these and change them in the same commit.
 */

const NAT: Partial<Record<CallRole, { w: number; h: number }>> = {
  remote: { w: 1075, h: 1408 },
  local: { w: 939, h: 1408 },
}

const CALL_PANEL = PANEL_CALL_SCENES[0].panel

/** A pixel of a drawing. */
type ArtPt = [number, number]

/**
 * The man's face as it is seen: in the mirror, since the man himself has his back to us.
 * The two head outlines are the first ink down a column of `cheating-man.webp`, 1075 ×
 * 1408, read from its pixels with the transparent background masked out; the belt, the
 * mirror's corners and the silhouette are read off the drawing by eye, which is all a
 * bound that generous needs.
 */
const MAN = {
  mouthSide: { minX: 385, maxX: 440, minY: 215, maxY: 300 },
  reflectedHair: [[300, 101], [360, 98], [390, 113]] as ArtPt[],
  backOfHead: [[650, 98], [700, 47], [750, 29], [800, 37], [835, 86]] as ArtPt[],
  // The shower door in the mirror is why this picture is funny; it has to stay in view.
  silhouette: [[505, 185], [500, 300]] as ArtPt[],
  mirrorCorners: [[170, 70], [605, 70], [170, 520], [600, 520]] as ArtPt[],
  belt: 580,
  /** Below this the panel would be showing leg. */
  hips: 700,
}

/**
 * Her outline, read off `despondent-wife.webp`, 939 × 1408, the same way: the first ink
 * down a column for the hair, the last ink along a row for the arm. The two points in her
 * dress are simply inside it, for the balloon that once sat there.
 */
const WOMAN = {
  mouthSide: { minX: 590, maxX: 670, minY: 380, maxY: 470 },
  hair: [
    [560, 41], [600, 106], [620, 111], [640, 114], [660, 125], [680, 160], [700, 169],
    [720, 209], [740, 224], [755, 278],
  ] as ArtPt[],
  body: [[666, 540], [707, 700], [779, 800], [744, 900], [450, 800], [480, 1000]] as ArtPt[],
}

const pagePolys = gridPolys(PANEL_GRIDS.home.landscape, frameRect(1440, 900, 'landscape'))
const panel = pagePolys[CALL_PANEL]
const scene = PANEL_CALL_SCENES[0]
const halves = splitAt(panel.vp, panel.bounds, scene.cut, scene.axis)

function halfOf(role: CallRole): SceneHalf {
  const half = halfFor(role, halves)
  if (!half) throw new Error(`no half for ${role}`)
  return half
}

function picture(role: CallRole): ImgTransform {
  const img = PANEL_IMG_TRANSFORMS.find(t => t.panel === CALL_PANEL && t.call === role)
  if (!img) throw new Error(`no picture for ${role}`)
  return img
}

function balloon(role: CallRole, content: string): BubbleTransform {
  const b = PANEL_BUBBLE_TRANSFORMS.find(
    t => t.panel === CALL_PANEL && t.call === role && t.content === content,
  )
  if (!b) throw new Error(`no ${content} balloon for ${role}`)
  return b
}

/** Where a pixel of the role's drawing lands on the page. */
function artToPage(role: CallRole, [ax, ay]: ArtPt): ArtPt {
  const { box } = halfOf(role)
  const nat = NAT[role]
  if (!nat) throw new Error(`no art for ${role}`)
  const img = picture(role)
  const f = imgFrameBox(box, img)
  const rect = renderedImgRect({ ...f, x: box.x + f.x, y: box.y + f.y }, nat, img)
  return [rect.x + (ax / nat.w) * rect.w, rect.y + (ay / nat.h) * rect.h]
}

/** Where a page point lands in the role's drawing. */
function pageToArt(role: CallRole, [px, py]: ArtPt): ArtPt {
  const nat = NAT[role]
  if (!nat) throw new Error(`no art for ${role}`)
  const [x0, y0] = artToPage(role, [0, 0])
  const [x1, y1] = artToPage(role, [nat.w, nat.h])
  return [((px - x0) / (x1 - x0)) * nat.w, ((py - y0) / (y1 - y0)) * nat.h]
}

/** The tip of a balloon's tail, in the pixels of the drawing it speaks for. */
function tailTipInArt(role: CallRole, content: string): ArtPt {
  const b = balloon(role, content)
  const r = bubbleRect(halfOf(role).box, b)
  const [tx, ty] = tailTip(b.tail)
  return pageToArt(role, [r.x + (tx / BUBBLE_VIEW.w) * r.w, r.y + (ty / BUBBLE_VIEW.h) * r.h])
}

/** Whether a pixel of the role's drawing sits under a balloon's base ellipse. */
function underBalloon(role: CallRole, content: string, art: ArtPt): boolean {
  const r = bubbleRect(halfOf(role).box, balloon(role, content))
  const [px, py] = artToPage(role, art)
  const ux = (((px - r.x) / r.w) * BUBBLE_VIEW.w - ELLIPSE.cx) / ELLIPSE.rx
  const uy = (((py - r.y) / r.h) * BUBBLE_VIEW.h - ELLIPSE.cy) / ELLIPSE.ry
  return ux * ux + uy * uy < 1
}

/** Whether a page point is inside a convex polygon, whichever way it winds. */
function insidePolygon(pts: readonly ArtPt[], [x, y]: ArtPt): boolean {
  const sides = pts.map(([ax, ay], i) => {
    const [bx, by] = pts[(i + 1) % pts.length]
    return Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax))
  })
  return !(sides.includes(1) && sides.includes(-1))
}

const within = ([x, y]: ArtPt, b: { minX: number; maxX: number; minY: number; maxY: number }) =>
  x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY

describe('the man who answered', () => {
  it('is cut off at the waist: the belt is in the panel, his legs are not', () => {
    const half = halfOf('remote')
    const floor = Math.max(...half.pts.map(([, y]) => y))
    const [, atFloor] = pageToArt('remote', [0, floor])
    expect(atFloor).toBeGreaterThan(MAN.belt)
    expect(atFloor).toBeLessThan(MAN.hips)
  })

  it('keeps the whole mirror in the panel', () => {
    const { pts } = halfOf('remote')
    for (const corner of MAN.mirrorCorners) {
      expect(insidePolygon(pts, artToPage('remote', corner))).toBe(true)
    }
  })

  it('speaks from the mouth in the mirror', () => {
    expect(within(tailTipInArt('remote', 'transcript'), MAN.mouthSide)).toBe(true)
  })

  it('keeps his balloon off both heads and the silhouette', () => {
    const clear = [...MAN.reflectedHair, ...MAN.backOfHead, ...MAN.silhouette]
    expect(clear.filter(p => underBalloon('remote', 'transcript', p))).toEqual([])
  })
})

describe('the woman placing the call', () => {
  it('speaks from her mouth', () => {
    expect(within(tailTipInArt('local', 'transcript'), WOMAN.mouthSide)).toBe(true)
  })

  it('keeps her balloon off her hair', () => {
    expect(WOMAN.hair.filter(p => underBalloon('local', 'transcript', p))).toEqual([])
  })

  it('keeps the number off her body', () => {
    expect(WOMAN.body.filter(p => underBalloon('local', 'number-hangup', p))).toEqual([])
  })

  it('keeps her transcript and the number apart', () => {
    const { box } = halfOf('local')
    const words = bubbleRect(box, balloon('local', 'transcript'))
    const line = bubbleRect(box, balloon('local', 'number-hangup'))
    const wordsFoot = words.y + (words.h * (ELLIPSE.cy + ELLIPSE.ry)) / BUBBLE_VIEW.h
    const lineHead = line.y + (line.h * (ELLIPSE.cy - ELLIPSE.ry)) / BUBBLE_VIEW.h
    expect(wordsFoot).toBeLessThan(lineHead)
  })
})
