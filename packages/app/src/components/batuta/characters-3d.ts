import * as THREE from "three"

export type CharacterRole = "orchestrator" | "worker"

const SKIN = 0xf2c9a0
const PALETTE: Record<CharacterRole, { body: number; accent: number }> = {
  orchestrator: { body: 0x1f2937, accent: 0xf59e0b },
  worker: { body: 0xf97316, accent: 0xea580c },
}

export interface Character {
  group: THREE.Group
  /** Pivot for the animated arm (baton wave for the orchestrator, working motion for a worker). */
  armPivot: THREE.Group
  materials: THREE.Material[]
  geometries: THREE.BufferGeometry[]
  dispose(): void
}

/**
 * Builds a small low-poly figure out of primitive geometries (capsule body,
 * sphere head, cylinder/cone headwear) — a real 3D character instead of a
 * flat sphere, per the threejs-geometry skill's guidance on composing
 * built-in shapes into a mesh hierarchy.
 */
export function buildCharacter(role: CharacterRole): Character {
  // The outer group is the one positioned/scaled by the caller — everything
  // is built inside `figure` and then shifted down so the group's origin
  // sits at the figure's vertical center (feet at y=0 would otherwise make
  // the character float above the DOM label anchored to this same point).
  const group = new THREE.Group()
  const figure = new THREE.Group()
  group.add(figure)
  const FIGURE_HEIGHT = 0.55
  figure.position.y = -FIGURE_HEIGHT / 2
  const materials: THREE.Material[] = []
  const geometries: THREE.BufferGeometry[] = []
  const palette = PALETTE[role]

  const material = (color: number) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 })
    materials.push(m)
    return m
  }
  const geometry = <T extends THREE.BufferGeometry>(g: T) => {
    geometries.push(g)
    return g
  }

  const skinMaterial = material(SKIN)
  const bodyMaterial = material(palette.body)
  const accentMaterial = material(palette.accent)

  const body = new THREE.Mesh(geometry(new THREE.CapsuleGeometry(0.15, 0.2, 4, 8)), bodyMaterial)
  body.position.y = 0.16
  figure.add(body)

  const head = new THREE.Mesh(geometry(new THREE.SphereGeometry(0.13, 16, 16)), skinMaterial)
  head.position.y = 0.42
  figure.add(head)

  if (role === "worker") {
    const cap = new THREE.Mesh(geometry(new THREE.CylinderGeometry(0.145, 0.145, 0.06, 16)), accentMaterial)
    cap.position.y = 0.5
    figure.add(cap)
    const brim = new THREE.Mesh(geometry(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 16)), accentMaterial)
    brim.position.y = 0.47
    figure.add(brim)
  } else {
    const collar = new THREE.Mesh(geometry(new THREE.TorusGeometry(0.1, 0.02, 8, 16)), accentMaterial)
    collar.position.y = 0.3
    collar.rotation.x = Math.PI / 2
    figure.add(collar)
  }

  // Static left arm.
  const armL = new THREE.Mesh(geometry(new THREE.CapsuleGeometry(0.035, 0.16, 4, 6)), skinMaterial)
  armL.position.set(-0.16, 0.22, 0)
  armL.rotation.z = 0.25
  figure.add(armL)

  // Animated right arm (baton for the orchestrator, tool motion for a worker).
  const armPivot = new THREE.Group()
  armPivot.position.set(0.16, 0.32, 0)
  const armR = new THREE.Mesh(geometry(new THREE.CapsuleGeometry(0.035, 0.16, 4, 6)), skinMaterial)
  armR.position.y = -0.08
  armPivot.add(armR)
  if (role === "orchestrator") {
    const baton = new THREE.Mesh(geometry(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 6)), accentMaterial)
    baton.position.y = -0.26
    armPivot.add(baton)
  } else {
    const tool = new THREE.Mesh(geometry(new THREE.BoxGeometry(0.05, 0.05, 0.02)), accentMaterial)
    tool.position.y = -0.2
    armPivot.add(tool)
  }
  figure.add(armPivot)

  const dispose = () => {
    materials.forEach((m) => m.dispose())
    geometries.forEach((g) => g.dispose())
  }

  return { group, armPivot, materials, geometries, dispose }
}
