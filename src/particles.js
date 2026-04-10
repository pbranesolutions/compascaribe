let canvas, ctx
let particles = []
let mouseX = -1000
let mouseY = -1000
let animationId

const COLORS = [
  'rgba(0, 255, 213, 0.8)',   // turquoise glow
  'rgba(255, 107, 53, 0.6)',  // coral
  'rgba(254, 245, 231, 0.7)', // sand white
  'rgba(123, 104, 238, 0.5)', // soft violet
  'rgba(0, 255, 213, 0.4)',   // turquoise dim
]

const PARTICLE_COUNT = 100

function createParticle() {
  return {
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.3 - 0.1,
    size: Math.random() * 2.5 + 1,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    opacity: Math.random() * 0.5 + 0.3,
    pulseSpeed: Math.random() * 0.02 + 0.005,
    pulseOffset: Math.random() * Math.PI * 2
  }
}

export function init(container) {
  canvas = document.createElement('canvas')
  canvas.style.position = 'fixed'
  canvas.style.top = '0'
  canvas.style.left = '0'
  canvas.style.zIndex = '1'
  canvas.style.pointerEvents = 'none'
  container.appendChild(canvas)

  ctx = canvas.getContext('2d')
  resize()

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(createParticle())
  }

  animate()
}

function animate() {
  animationId = requestAnimationFrame(animate)
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const time = performance.now() * 0.001

  for (const p of particles) {
    // Mouse repulsion
    const dx = p.x - mouseX
    const dy = p.y - mouseY
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 120) {
      const force = (120 - dist) / 120 * 0.8
      p.vx += (dx / dist) * force
      p.vy += (dy / dist) * force
    }

    // Dampen velocity
    p.vx *= 0.99
    p.vy *= 0.99

    // Move
    p.x += p.vx
    p.y += p.vy

    // Wrap edges
    if (p.x < -10) p.x = canvas.width + 10
    if (p.x > canvas.width + 10) p.x = -10
    if (p.y < -10) p.y = canvas.height + 10
    if (p.y > canvas.height + 10) p.y = -10

    // Pulse opacity
    const pulse = Math.sin(time * p.pulseSpeed * 60 + p.pulseOffset) * 0.3 + 0.7

    // Draw
    ctx.save()
    ctx.globalAlpha = p.opacity * pulse
    ctx.fillStyle = p.color
    ctx.shadowColor = p.color
    ctx.shadowBlur = p.size * 3
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

export function updateMouse(x, y) {
  mouseX = x
  mouseY = y
}

export function resize() {
  if (!canvas) return
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
}

export function dispose() {
  if (animationId) cancelAnimationFrame(animationId)
}
