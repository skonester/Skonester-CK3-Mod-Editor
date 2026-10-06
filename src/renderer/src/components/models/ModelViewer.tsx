import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Maximize2 } from 'lucide-react'
import type { ModelGeometry, PortraitPart, ShaderProgram } from '@crusaderpope/shared/api'
import { api } from '@crusaderpope/renderer/src/api'
import {
  addViewLights,
  disposeScene,
  gameRenderer,
  geometry,
  loadEnvironment,
  material
} from '@crusaderpope/renderer/src/three/pdx'
import {
  createGameScene,
  drawnPositions,
  gameGeometry,
  gameMaterial,
  isSkinned,
  programFor
} from '@crusaderpope/renderer/src/three/gameShader'
import { digest, useGfxRevision } from '@crusaderpope/renderer/src/revision'
import { viewerPixelRatio } from '@crusaderpope/renderer/src/graphics'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

/** Parts shown only on request: simplified LOD copies, terrain decal planes, sky domes around court rooms */
const isExtra = (p: PortraitPart): boolean => !!p.lod || !!p.decal || /skybox/i.test(p.name)

type Programs = (ShaderProgram | Error | null)[]

interface Look {
  gameShaders: boolean
  textured: boolean
  wire: boolean
  extras: boolean
}

/**
 * The three.js stage of one model (CrusaderPope's MeshViewer scene): every part
 * with its game shader where it compiled, framed from the front-left, orbit
 * controls. Rebuilt when the model or a toggle changes.
 */
function ModelStage({
  data,
  programs,
  look,
  className
}: {
  data: ModelGeometry
  programs: Programs | undefined
  look: Look
  className?: string
}): React.JSX.Element {
  const mount = useRef<HTMLDivElement>(null)
  const { gameShaders, textured, wire, extras } = look

  useEffect(() => {
    const el = mount.current
    if (!el || !data.parts.length) return
    const renderer = gameRenderer(el.clientWidth, el.clientHeight)
    // The portrait exposure includes the game's bloom lift: too hot for lit-from-the-front models
    renderer.toneMappingExposure = 1.9
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const disposeEnvironment = loadEnvironment(renderer, scene)
    const game = createGameScene(renderer)
    // Meshes creatures show get the decal list of the first character showing them
    if (data.decals?.length) game.setDecalList(data.decals)

    const group = new THREE.Group()
    const framed = new THREE.Box3()
    const all = new THREE.Box3()
    const v = new THREE.Vector3()
    data.parts.forEach((part, i) => {
      const extra = isExtra(part)
      if (extra && !extras) return
      const prog = gameShaders && textured ? programs?.[i] : null
      let mesh: THREE.Mesh
      if (prog && !(prog instanceof Error)) {
        const mat = gameMaterial(prog, part, game)
        mat.wireframe = wire
        mesh = new THREE.Mesh(gameGeometry(part, prog), mat)
        // Game-space vertices: three's culling would test the unmirrored bounds
        mesh.frustumCulled = false
      } else {
        const mat = textured
          ? material(part)
          : new THREE.MeshStandardMaterial({ color: 0xb8ab98, roughness: 0.75, metalness: 0 })
        if (wire) (mat as THREE.MeshStandardMaterial).wireframe = true
        mesh = new THREE.Mesh(geometry(part), mat)
        mesh.castShadow = !part.decal
        mesh.receiveShadow = true
      }
      mesh.renderOrder = part.cutout ? 2 : 0
      group.add(mesh)
      // Bounds in three.js space (Z mirrored) from the vertices as drawn (GPU-skinned parts posed)
      const box = new THREE.Box3()
      const pos = drawnPositions(part, prog instanceof Error ? null : prog)
      for (let k = 0; k < pos.length; k += 3)
        box.expandByPoint(v.set(pos[k], pos[k + 1], -pos[k + 2]))
      all.union(box)
      if (!extra) framed.union(box)
    })
    scene.add(group)
    if (framed.isEmpty()) framed.copy(all)

    // From the front-left, a little above, just far enough for every corner of the box to fit the view
    const sphere = framed.getBoundingSphere(new THREE.Sphere())
    const r = Math.max(sphere.radius, 1e-3)
    const fov = 30
    const aspect = el.clientWidth / el.clientHeight
    const camera = new THREE.PerspectiveCamera(fov, aspect, r / 200, r * 40)
    const center = framed.getCenter(new THREE.Vector3())
    const back = new THREE.Vector3(0.45, 0.3, 1).normalize()
    const right = new THREE.Vector3(0, 1, 0).cross(back).normalize()
    const up = back.clone().cross(right)
    const tanV = Math.tan((fov * Math.PI) / 360)
    const tanH = tanV * aspect
    let dist = 0
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Vector3(
        i & 1 ? framed.max.x : framed.min.x,
        i & 2 ? framed.max.y : framed.min.y,
        i & 4 ? framed.max.z : framed.min.z
      ).sub(center)
      const depth = c.dot(back)
      dist = Math.max(
        dist,
        depth + Math.abs(c.dot(right)) / tanH,
        depth + Math.abs(c.dot(up)) / tanV
      )
    }
    camera.position.copy(center).addScaledVector(back, Math.max(dist * 1.08, r * 0.2))
    camera.lookAt(center)
    sphere.center.copy(center)
    addViewLights(scene, camera, center, camera.position.distanceTo(center), r * 1.2)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.copy(sphere.center)
    controls.enableDamping = true
    controls.minDistance = r * 0.05
    controls.maxDistance = r * 12
    controls.update()

    let frame = 0
    const loop = (): void => {
      frame = requestAnimationFrame(loop)
      controls.update()
      game.update(camera)
      renderer.render(scene, camera)
    }
    loop()
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (!w || !h) return
      renderer.setPixelRatio(viewerPixelRatio(w, h))
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      controls.dispose()
      disposeEnvironment()
      disposeScene(scene)
      game.dispose()
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [data, programs, gameShaders, textured, wire, extras])

  return (
    <div
      ref={mount}
      className={cn('relative overflow-hidden rounded-lg border bg-muted/30', className)}
    />
  )
}

/**
 * A 3D preview of a model file in its bind pose — a .mesh with the textures
 * its pdxmesh declares, or one pdxmesh of an .asset — drawn with the game's
 * own shaders where their Effect compiles (ported from CrusaderPope).
 */
export default function ModelViewer({
  path,
  pdxmesh
}: {
  path: string
  pdxmesh?: string
}): React.JSX.Element {
  const [data, setData] = useState<ModelGeometry | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [look, setLook] = useState<Look>({
    gameShaders: true,
    textured: true,
    wire: false,
    extras: false
  })
  const [programs, setPrograms] = useState<Programs | undefined>(undefined)
  const [big, setBig] = useState(false)

  // Again after an index update that changed gfx files (an import into the mod);
  // not redrawn when the model is the same
  const gfx = useGfxRevision()
  const shown = useRef('')
  useEffect(() => {
    setData(undefined)
    shown.current = ''
  }, [path, pdxmesh])
  useEffect(() => {
    let cancelled = false
    setError(null)
    api
      .modelGeometry(path, pdxmesh)
      .then((g) => {
        if (cancelled) return
        const key = digest(g)
        if (key === shown.current) return
        shown.current = key
        setData(g)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [path, pdxmesh, gfx])

  // The game's shaders of all parts (cached per Effect and vertex layout)
  useEffect(() => {
    setPrograms(undefined)
    if (!data?.parts.length || !look.gameShaders) return
    let cancelled = false
    void Promise.all(
      data.parts.map((p) => {
        const pr = programFor(p)
        return pr ? pr.catch((e: Error) => e) : Promise.resolve(null)
      })
    ).then((list) => !cancelled && setPrograms(list))
    return () => {
      cancelled = true
    }
  }, [data, look.gameShaders])

  const waiting =
    look.gameShaders && look.textured && !!data?.parts.length && programs === undefined
  const vertices = data?.parts.reduce((s, p) => s + p.positions.length / 3, 0) ?? 0
  const extraCount = data?.parts.filter(isExtra).length ?? 0
  const failed = (programs ?? [])
    .map((p, i) => (p instanceof Error ? `${data?.parts[i]?.shader}: ${p.message}` : null))
    .filter((x): x is string => x !== null)
  const viaGame = (programs ?? []).filter((p) => p && !(p instanceof Error)).length
  // GPU-skinned parts show the entity's default animation at its first frame, the others the bind pose
  const posed =
    look.gameShaders &&
    look.textured &&
    !!data?.pose &&
    (programs ?? []).some((p) => p && !(p instanceof Error) && isSkinned(p))

  const toggle = (key: keyof Look, label: string, title: string): React.JSX.Element => (
    <Toggle
      size="sm"
      variant="outline"
      pressed={look[key]}
      title={title}
      onPressedChange={(on) => setLook({ ...look, [key]: on })}
    >
      {label}
    </Toggle>
  )
  const toggles = (
    <div className="flex flex-wrap gap-1.5">
      {toggle(
        'gameShaders',
        'Game shaders',
        "Render with the game's own shaders (gfx/FX compiled for WebGL), or with the viewer's approximation"
      )}
      {toggle(
        'textured',
        'Textures',
        'Materials with their textures, or plain clay to judge the shape'
      )}
      {toggle('wire', 'Wireframe', 'Show the triangles')}
      {extraCount > 0 &&
        toggle(
          'extras',
          `LODs & decals (${extraCount})`,
          'Simplified LOD copies, terrain decal planes and sky domes (hidden by default)'
        )}
    </div>
  )

  let note: React.ReactNode = null
  if (error) note = <span className="text-destructive">Preview failed: {error}</span>
  else if (data === undefined) note = 'Loading the model…'
  else if (data === null) note = 'No geometry to show.'
  else if (data.parts.length === 0) note = 'This mesh file holds no geometry.'
  else if (waiting) note = "Compiling the game's shaders…"

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        {data && data.parts.length > 0 && !waiting ? (
          <ModelStage data={data} programs={programs} look={look} className="aspect-[4/3] w-full" />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center gap-2 rounded-lg border bg-muted/30 text-sm text-muted-foreground">
            {!error && (data === undefined || waiting) && <Spinner />}
            {note}
          </div>
        )}
        {data && data.parts.length > 0 && (
          <Button
            variant="secondary"
            size="icon-xs"
            className="absolute top-2 right-2"
            title="Enlarge"
            onClick={() => setBig(true)}
          >
            <Maximize2 />
          </Button>
        )}
      </div>
      {data && data.parts.length > 0 && (
        <>
          {toggles}
          <p className="text-xs text-muted-foreground">
            {data.parts.length} part{data.parts.length === 1 ? '' : 's'} ·{' '}
            {vertices.toLocaleString()} vertices
            {data.bones
              ? ` · ${data.bones} bones (${posed ? `GPU-skinned: ${data.pose}, first frame` : 'bind pose'})`
              : ''}
            {data.decalsFrom && ` · colours of ${data.decalsFrom}`}
            {look.gameShaders && programs && (
              <span title={failed.join('\n\n')}>
                {' '}
                ·{' '}
                {viaGame === data.parts.length
                  ? 'game shaders'
                  : `game shaders on ${viaGame} of ${data.parts.length} parts`}
                {failed.length > 0 && (
                  <span className="text-destructive">
                    {' '}
                    ({failed.length} failed to compile — hover)
                  </span>
                )}
              </span>
            )}
          </p>
        </>
      )}
      <Dialog open={big} onOpenChange={setBig}>
        <DialogContent className="flex h-[85vh] flex-col sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{pdxmesh ?? path.slice(path.lastIndexOf('/') + 1)}</DialogTitle>
            <DialogDescription>Drag to turn, right drag to move, scroll to zoom.</DialogDescription>
          </DialogHeader>
          {big && data && !waiting && (
            <ModelStage data={data} programs={programs} look={look} className="min-h-0 flex-1" />
          )}
          {toggles}
        </DialogContent>
      </Dialog>
    </div>
  )
}
