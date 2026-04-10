import * as THREE from 'three'
import { Water } from 'three/addons/objects/Water.js'
import { Sky } from 'three/addons/objects/Sky.js'

let renderer, scene, camera, water, sun, sky
let animationId

const SUN_PARAMS = {
  turbidity: 10,
  rayleigh: 2,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.8,
  elevation: 3,
  azimuth: 180
}

export function init(container) {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.5
  container.appendChild(renderer.domElement)
  renderer.domElement.style.position = 'fixed'
  renderer.domElement.style.top = '0'
  renderer.domElement.style.left = '0'
  renderer.domElement.style.zIndex = '0'

  scene = new THREE.Scene()

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 20000)
  camera.position.set(0, 30, 100)

  // Sun
  sun = new THREE.Vector3()

  // Water
  const waterGeometry = new THREE.PlaneGeometry(10000, 10000)
  water = new Water(waterGeometry, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals: new THREE.TextureLoader().load('/textures/waternormals.jpg', (texture) => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    }),
    sunDirection: new THREE.Vector3(),
    sunColor: 0xff6b35,
    waterColor: 0x006994,
    distortionScale: 4,
    fog: scene.fog !== undefined
  })
  water.rotation.x = -Math.PI / 2
  scene.add(water)

  // Sky
  sky = new Sky()
  sky.scale.setScalar(10000)
  scene.add(sky)

  updateSun()

  animate()
}

function updateSun() {
  const uniforms = sky.material.uniforms
  uniforms['turbidity'].value = SUN_PARAMS.turbidity
  uniforms['rayleigh'].value = SUN_PARAMS.rayleigh
  uniforms['mieCoefficient'].value = SUN_PARAMS.mieCoefficient
  uniforms['mieDirectionalG'].value = SUN_PARAMS.mieDirectionalG

  const phi = THREE.MathUtils.degToRad(90 - SUN_PARAMS.elevation)
  const theta = THREE.MathUtils.degToRad(SUN_PARAMS.azimuth)
  sun.setFromSphericalCoords(1, phi, theta)

  sky.material.uniforms['sunPosition'].value.copy(sun)
  water.material.uniforms['sunDirection'].value.copy(sun).normalize()

  const pmremGenerator = new THREE.PMREMGenerator(renderer)
  const sceneEnv = new THREE.Scene()
  sceneEnv.add(sky.clone())
  const renderTarget = pmremGenerator.fromScene(sceneEnv)
  scene.environment = renderTarget.texture
  pmremGenerator.dispose()
  sceneEnv.clear()
}

let driftAngle = 0

function animate() {
  animationId = requestAnimationFrame(animate)

  // Subtle camera drift
  driftAngle += 0.0003
  camera.position.x = Math.sin(driftAngle) * 15
  camera.lookAt(0, 0, 0)

  water.material.uniforms['time'].value += 1.0 / 60.0

  renderer.render(scene, camera)
}

export function resize() {
  if (!renderer) return
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

export function dispose() {
  if (animationId) cancelAnimationFrame(animationId)
  renderer?.dispose()
}
