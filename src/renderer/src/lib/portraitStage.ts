/**
 * The 3D stage of a portrait: renderer, environment, the game's constants,
 * camera and controls, kept while the figure on it changes. Adapted from
 * CrusaderPope (src/renderer/src/components/PortraitViewer.tsx, GPL-3.0 with
 * the Commons Clause — see NOTICE.md): its PortraitStage, creatureView and
 * pendingOf, unchanged but for being exported; its React component is
 * CharacterPortrait here, built on the app's own UI.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { PortraitData, ShaderProgram } from '@crusaderpope/shared/api'
import {
  addGameLights,
  disposeScene,
  gameRenderer,
  geometry,
  loadEnvironment,
  loaded,
  material
} from '@crusaderpope/renderer/src/three/pdx'
import {
  createGameScene,
  gameGeometry,
  gameMaterial,
  PORTRAIT_ENVIRONMENT,
  type GameScene
} from '@crusaderpope/renderer/src/three/gameShader'
import { digest } from '@crusaderpope/renderer/src/revision'
import { viewerPixelRatio } from '@crusaderpope/renderer/src/graphics'

/**
 * Camera for a whole creature: from the front-left and a little above, the silhouette centred and fitted into the
 * view (a sample of the vertices, three.js space). `fit(aspect)` is the camera distance for a view shape — the
 * enlarged view refits with it.
 */
function creatureView(
  parts: PortraitData['parts'],
  aspect: number
): {
  camera: THREE.PerspectiveCamera
  target: THREE.Vector3
  radius: number
  fit: (aspect: number) => number
} {
  const pts: THREE.Vector3[] = []

  for (const p of parts)
    for (let i = 0; i + 2 < p.positions.length; i += 3 * 5)
      pts.push(new THREE.Vector3(p.positions[i], p.positions[i + 1], -p.positions[i + 2]))

  const box = new THREE.Box3().setFromPoints(pts)
  const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1)
  const fov = 35
  const back = new THREE.Vector3(0.6, 0.3, 1).normalize()
  const right = new THREE.Vector3(0, 1, 0).cross(back).normalize()
  const up = back.clone().cross(right)
  // centre of the silhouette seen along `back`
  const c0 = box.getCenter(new THREE.Vector3())
  const ext = [Infinity, -Infinity, Infinity, -Infinity]
  const d = new THREE.Vector3()

  for (const p of pts) {
    d.subVectors(p, c0)
    ext[0] = Math.min(ext[0], d.dot(right))
    ext[1] = Math.max(ext[1], d.dot(right))
    ext[2] = Math.min(ext[2], d.dot(up))
    ext[3] = Math.max(ext[3], d.dot(up))
  }

  const target = c0
    .clone()
    .addScaledVector(right, (ext[0] + ext[1]) / 2)
    .addScaledVector(up, (ext[2] + ext[3]) / 2)
  const tanV = Math.tan((fov * Math.PI) / 360)
  const fit = (a: number): number => {
    let dist = 0

    for (const p of pts) {
      d.subVectors(p, target)
      const depth = d.dot(back)
      dist = Math.max(
        dist,
        depth + Math.abs(d.dot(right)) / (tanV * a),
        depth + Math.abs(d.dot(up)) / tanV
      )
    }

    return dist * 1.05
  }
  const camera = new THREE.PerspectiveCamera(fov, aspect, radius / 100, radius * 30)
  camera.position.copy(target).addScaledVector(back, fit(aspect))
  camera.lookAt(target)
  return { camera, target, radius, fit }
}

/** What the stage shows: a portrait's parts, with the programs of their game shaders (null: the viewer's materials). */
export interface Figure {
  data: PortraitData
  programs: (ShaderProgram | Error | null)[] | null
}

/** Every texture a figure's materials sample, and the uniforms whose texture arrives later (texture arrays). */
function pendingOf(group: THREE.Object3D): object[] {
  const out = new Set<object>()
  const add = (v: unknown): void => {
    if (v instanceof THREE.Texture) out.add(v)
    else if (Array.isArray(v)) v.forEach(add)
  }
  group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return

    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const v of Object.values(m)) add(v)

      const uniforms = (m as THREE.ShaderMaterial).uniforms

      for (const u of Object.values(uniforms ?? {})) {
        out.add(u)
        add(u.value)
      }
    }
  })
  return [...out]
}

/**
 * The 3D view of one entry, kept while its toggles change: renderer, environment, the game's constants, camera and
 * controls stay. A new figure is built beside the shown one and replaces it once its textures are there and its
 * shaders compiled — no blank frames in between, and the camera stays where it was turned.
 */
export class PortraitStage {
  readonly el: HTMLDivElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private game: GameScene
  private camera = new THREE.PerspectiveCamera(24, 1, 1, 3000)
  private controls: OrbitControls
  private figure: THREE.Group | null = null
  private lights: THREE.Group | null = null
  private framed = false
  // creatures: camera distance for a view shape (the enlarged view is wider than the card)
  private refit?: (aspect: number) => void
  private decals = ''
  private token = 0
  private frame = 0
  private ro: ResizeObserver
  private disposeEnvironment: () => void

  constructor(el: HTMLDivElement) {
    this.el = el
    const width = el.clientWidth
    const height = el.clientHeight
    this.renderer = gameRenderer(width, height)
    el.appendChild(this.renderer.domElement)
    this.disposeEnvironment = loadEnvironment(this.renderer, this.scene)
    this.game = createGameScene(this.renderer, PORTRAIT_ENVIRONMENT)
    this.camera.aspect = width / height
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    const loop = (): void => {
      this.frame = requestAnimationFrame(loop)

      if (!this.figure) return

      this.controls.update()
      this.game.update(this.camera)
      this.renderer.render(this.scene, this.camera)
    }
    loop()
    this.ro = new ResizeObserver(() => {
      const w = el.clientWidth
      const h = el.clientHeight

      if (!w || !h) return

      // keep the supersampled back buffer bounded when enlarged
      this.renderer.setPixelRatio(viewerPixelRatio(w, h))
      this.renderer.setSize(w, h)
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
      this.refit?.(w / h)
    })
    this.ro.observe(el)
  }

  /** Builds the figure and shows it in place of the current one; `shown` once it is on screen (not if overtaken). */
  async show(f: Figure, shown: () => void): Promise<void> {
    const token = ++this.token
    const { data, programs } = f
    let hidden: string[] = []

    try {
      // debug aid: localStorage portrait.hide = "skin,eye,clothes" hides parts by kind or accessory gene
      hidden = (localStorage.getItem('portrait.hide') ?? '').split(',').filter(Boolean)
    } catch {
      /* ignore */
    }

    const group = new THREE.Group()
    let eyes: THREE.Box3 | null = null
    const box = new THREE.Box3()
    const v = new THREE.Vector3()

    for (let i = 0; i < data.parts.length; i++) {
      const part = data.parts[i]
      const prog = programs?.[i]
      let mesh: THREE.Mesh

      if (prog && !(prog instanceof Error)) {
        mesh = new THREE.Mesh(gameGeometry(part, prog), gameMaterial(prog, part, this.game))
        mesh.frustumCulled = false // game-space vertices
      } else {
        mesh = new THREE.Mesh(geometry(part), material(part))
        // eyes and teeth sit inside the head: they would only shadow themselves
        mesh.castShadow = part.kind !== 'eye' && part.kind !== 'teeth'
        mesh.receiveShadow = true
      }

      mesh.renderOrder = part.cutout ? 2 : 0

      if (hidden.includes(part.kind) || hidden.includes(part.group ?? '')) mesh.visible = false

      group.add(mesh)
      // bounds in three.js space (Z mirrored) from the vertices themselves
      const pb = new THREE.Box3()

      for (let k = 0; k < part.positions.length; k += 3)
        pb.expandByPoint(v.set(part.positions[k], part.positions[k + 1], -part.positions[k + 2]))

      box.union(pb)

      if (part.kind === 'eye') eyes = (eyes ?? new THREE.Box3()).union(pb)
    }

    // the light rig around the figure, and the camera for its first figure
    const width = this.el.clientWidth || 1
    const height = this.el.clientHeight || 1
    let chest: THREE.Vector3
    let k: number
    let shadowSize: number
    let frame: () => void

    if (data.creature) {
      // a creature (AGOT's dragons): all of it, from the front-left and a little above, like the game's dragon
      // portrait camera (camera_dragon: from the side of the head, 35° field of view — the game zooms by its size)
      const view = creatureView(data.parts, width / height)
      // the portrait light rig scaled to the creature (a human figure is k = 1): positions, spot ranges and shadows
      k = view.radius / 110
      chest = new THREE.Vector3(view.target.x, view.target.y + view.radius * 0.1, view.target.z)
      shadowSize = view.radius * 1.2
      frame = () => {
        Object.assign(this.camera, {
          fov: view.camera.fov,
          near: view.camera.near,
          far: view.camera.far
        })
        this.camera.position.copy(view.camera.position)
        this.controls.target.copy(view.target)
        this.controls.minDistance = view.radius * 0.08
        this.controls.maxDistance = view.radius * 8
        let fitted = width / height
        this.refit = (aspect) => {
          const scale = view.fit(aspect) / view.fit(fitted)
          this.camera.position
            .sub(this.controls.target)
            .multiplyScalar(scale)
            .add(this.controls.target)
          fitted = aspect
        }
      }
    } else {
      // frame head and shoulders like the game's portraits: a little below the eyes, slightly from the side
      const eyeY = eyes ? eyes.getCenter(new THREE.Vector3()).y : box.max.y - 14
      const center = box.getCenter(new THREE.Vector3())
      // children are smaller: scale the framing by eye height above the feet (≈166 for adults)
      k = Math.max(0.45, Math.min(1.2, (eyeY - box.min.y) / 166))
      const eyeZ = eyes ? eyes.getCenter(new THREE.Vector3()).z : center.z
      const target = new THREE.Vector3(center.x, eyeY - 13 * k, eyeZ - 6 * k)
      // the game's three portrait lights around the chest ("camera_torso_look_at"), directions as scripted — for the
      // viewer's own materials as three.js lights, for the game shaders as their Light_* constants (game space)
      chest = new THREE.Vector3(center.x, eyeY - 32 * k, eyeZ - 8 * k)
      shadowSize = 70 * k
      const kk = k
      frame = () => {
        Object.assign(this.camera, { fov: 24, near: 1, far: 3000 })
        this.camera.position.set(target.x + 36 * kk, target.y + 6 * kk, target.z + 150 * kk)
        this.controls.target.copy(target)
        this.controls.minDistance = 20
        this.controls.maxDistance = 600
        this.refit = undefined
      }
    }

    if (!this.framed) {
      frame()
      this.framed = true
      this.camera.updateProjectionMatrix()
      this.controls.update()
    }

    const lights = new THREE.Group()
    addGameLights(lights, chest, k, shadowSize)

    // wait for the new figure's textures (a few seconds at most) and compile its programs off the render loop
    const drop = (): void => {
      disposeScene(group)
      disposeScene(lights)
    }
    await Promise.race([
      Promise.all(pendingOf(group).map(loaded)),
      new Promise((r) => setTimeout(r, 4000))
    ])

    if (token !== this.token) return drop()

    try {
      const probe = new THREE.Scene()
      probe.environment = this.scene.environment
      probe.add(lights)
      await this.renderer.compileAsync(group, this.camera, probe)
    } catch {
      /* compiled when drawn */
    }

    if (token !== this.token) return drop()

    // the swap: decals and light constants of the game shaders, the rig, the figure
    const decalKey = data.decals?.length
      ? 'list:' + digest(data.decals)
      : 'data:' + digest(data.dataDecals ?? [])

    if (decalKey !== this.decals) {
      // creatures: the whole decal list their shaders colour them by; humans: the decals the bake leaves out but
      // shaders read (AGOT's control decals: salt-and-pepper hair …)
      if (data.decals?.length) this.game.setDecalList(data.decals)
      else this.game.setDecals(data.dataDecals ?? [])

      this.decals = decalKey
    }

    this.game.setPortraitLights(new THREE.Vector3(chest.x, chest.y, -chest.z), k, !!data.creature)

    if (this.lights) {
      this.scene.remove(this.lights)
      disposeScene(this.lights)
    }

    this.scene.add(lights)
    this.lights = lights

    if (this.figure) {
      this.scene.remove(this.figure)
      disposeScene(this.figure)
    }

    this.scene.add(group)
    this.figure = group
    shown()
  }

  dispose(): void {
    this.token++
    cancelAnimationFrame(this.frame)
    this.ro.disconnect()
    this.controls.dispose()
    this.disposeEnvironment()
    disposeScene(this.scene)
    this.game.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
