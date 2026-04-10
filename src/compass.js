import { gsap } from 'gsap'

let compassEl, needleEl
let currentAngle = 0
let targetAngle = 0

export function init(container) {
  compassEl = document.createElement('div')
  compassEl.className = 'compass'
  compassEl.innerHTML = createCompassSVG()
  container.appendChild(compassEl)

  needleEl = compassEl.querySelector('#compass-needle')

  // Smooth needle tracking
  gsap.ticker.add(() => {
    // Shortest rotation path
    let diff = targetAngle - currentAngle
    if (diff > 180) diff -= 360
    if (diff < -180) diff += 360
    currentAngle += diff * 0.08
    if (needleEl) {
      needleEl.setAttribute('transform', `rotate(${currentAngle}, 100, 100)`)
    }
  })
}

export function updateMouse(x, y) {
  if (!compassEl) return
  const rect = compassEl.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const angle = Math.atan2(y - cy, x - cx) * (180 / Math.PI) + 90
  targetAngle = angle
}

function createCompassSVG() {
  return `
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" class="compass-svg">
      <!-- Outer ring -->
      <circle cx="100" cy="100" r="90" fill="none" stroke="#00ffd5" stroke-width="1.5" opacity="0.6"/>
      <circle cx="100" cy="100" r="85" fill="none" stroke="#00ffd5" stroke-width="0.5" opacity="0.3"/>

      <!-- Tick marks -->
      ${generateTicks()}

      <!-- Cardinal directions -->
      <text x="100" y="28" text-anchor="middle" fill="#fef5e7" font-family="'Space Grotesk', sans-serif" font-size="12" font-weight="700">N</text>
      <text x="100" y="182" text-anchor="middle" fill="#fef5e7" font-family="'Space Grotesk', sans-serif" font-size="12" font-weight="700">S</text>
      <text x="178" y="104" text-anchor="middle" fill="#fef5e7" font-family="'Space Grotesk', sans-serif" font-size="12" font-weight="700">E</text>
      <text x="22" y="104" text-anchor="middle" fill="#fef5e7" font-family="'Space Grotesk', sans-serif" font-size="12" font-weight="700">W</text>

      <!-- Compass rose (8-point star) -->
      <polygon points="100,45 106,85 100,80 94,85" fill="#00ffd5" opacity="0.3"/>
      <polygon points="100,155 106,115 100,120 94,115" fill="#00ffd5" opacity="0.3"/>
      <polygon points="45,100 85,94 80,100 85,106" fill="#00ffd5" opacity="0.3"/>
      <polygon points="155,100 115,94 120,100 115,106" fill="#00ffd5" opacity="0.3"/>

      <!-- Diagonal points -->
      <polygon points="61,61 88,88 84,92 58,65" fill="#00ffd5" opacity="0.15"/>
      <polygon points="139,61 112,88 116,92 142,65" fill="#00ffd5" opacity="0.15"/>
      <polygon points="61,139 88,112 84,108 58,135" fill="#00ffd5" opacity="0.15"/>
      <polygon points="139,139 112,112 116,108 142,135" fill="#00ffd5" opacity="0.15"/>

      <!-- Inner circle -->
      <circle cx="100" cy="100" r="8" fill="none" stroke="#00ffd5" stroke-width="1" opacity="0.5"/>
      <circle cx="100" cy="100" r="3" fill="#00ffd5" opacity="0.8"/>

      <!-- Needle group -->
      <g id="compass-needle">
        <!-- North needle (hot pink) -->
        <polygon points="100,35 104,95 100,100 96,95" fill="#ff2d7b" opacity="0.9"/>
        <!-- South needle (dim) -->
        <polygon points="100,165 104,105 100,100 96,105" fill="#fef5e7" opacity="0.2"/>
      </g>

      <!-- Glow filter -->
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
    </svg>
  `
}

function generateTicks() {
  let ticks = ''
  for (let i = 0; i < 36; i++) {
    const angle = i * 10
    const isCardinal = angle % 90 === 0
    const isMajor = angle % 30 === 0
    const len = isCardinal ? 0 : isMajor ? 8 : 4
    const r1 = 90 - len
    const r2 = 90
    const rad = (angle - 90) * (Math.PI / 180)
    const x1 = 100 + r1 * Math.cos(rad)
    const y1 = 100 + r1 * Math.sin(rad)
    const x2 = 100 + r2 * Math.cos(rad)
    const y2 = 100 + r2 * Math.sin(rad)
    if (!isCardinal) {
      ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#00ffd5" stroke-width="${isMajor ? 1 : 0.5}" opacity="${isMajor ? 0.6 : 0.3}"/>`
    }
  }
  return ticks
}
