import './style.css'
import { gsap } from 'gsap'
import * as ocean from './ocean.js'
import * as particles from './particles.js'
import * as compass from './compass.js'

// Shared mouse state
let mouseX = window.innerWidth / 2
let mouseY = window.innerHeight / 2

// Init all layers
const canvasContainer = document.getElementById('canvas-container')
const compassContainer = document.getElementById('compass-container')

ocean.init(canvasContainer)
particles.init(canvasContainer)
compass.init(compassContainer)

// Mouse tracking
document.addEventListener('mousemove', (e) => {
  mouseX = e.clientX
  mouseY = e.clientY
  particles.updateMouse(mouseX, mouseY)
  compass.updateMouse(mouseX, mouseY)
})

// Touch tracking
document.addEventListener('touchmove', (e) => {
  const touch = e.touches[0]
  mouseX = touch.clientX
  mouseY = touch.clientY
  particles.updateMouse(mouseX, mouseY)
  compass.updateMouse(mouseX, mouseY)
}, { passive: true })

// Resize
window.addEventListener('resize', () => {
  ocean.resize()
  particles.resize()
})

// --- Entrance animation ---
// Query elements AFTER init so dynamically-created elements exist
const blackout = document.getElementById('blackout')
const title = document.querySelector('.title')
const subtitle = document.querySelector('.subtitle')
const compassEl = document.querySelector('.compass')

const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

tl.to(blackout, {
  opacity: 0,
  duration: 1.5,
  ease: 'power2.inOut',
  onComplete: () => blackout.remove()
})
.to(title, {
  opacity: 1,
  y: 0,
  duration: 1.2,
}, '-=0.5')
.to(subtitle, {
  opacity: 0.8,
  duration: 1,
}, '-=0.6')
.to(compassEl, {
  opacity: 1,
  scale: 1,
  duration: 1,
  ease: 'back.out(1.7)',
}, '-=0.5')
.add(() => {
  // Animate vignette pseudo-element via CSS custom property
  gsap.to(document.documentElement, {
    '--vignette-opacity': 1,
    duration: 1.5,
    ease: 'power2.inOut'
  })
  // Activate continuous animations
  title.classList.add('active')
  compassEl.classList.add('active')
}, '-=0.3')
