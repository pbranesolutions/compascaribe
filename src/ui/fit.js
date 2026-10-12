// Fit-to-viewport utilities. The zero-scroll constraint is enforced here, not
// hoped for: text is sized to its box, long text is paginated, and an audit can
// prove no element overflows.

/**
 * Shrink (or grow) an element's font-size, within [min, max] px, until its
 * content fits its own box. The element must have a bounded height (grid row,
 * fixed height, or flex with min-height 0).
 */
export function fitText(el, { min = 13, max = 64, step = 0.5 } = {}) {
  if (!el || !el.isConnected) return
  // The available height is the box's declared max-height when it is
  // content-sized, or its own height when the layout fixes it (a grid track).
  // Natural content height is measured on a hidden clone so the element's own
  // clipping never masks overflow. Glyphs may hang a few pixels outside the
  // line box, hence the tolerance.
  const cs = getComputedStyle(el)
  const maxH = parseFloat(cs.maxHeight)
  const width = el.clientWidth
  const limit = Number.isFinite(maxH) && maxH > 0 ? maxH : el.clientHeight
  if (!width || !limit) return
  const clone = el.cloneNode(true)
  clone.removeAttribute('id')
  clone.setAttribute('aria-hidden', 'true')
  clone.classList.add('measure')
  Object.assign(clone.style, { position: 'absolute', left: '-99999px', top: '0', width: `${width}px`, height: 'auto', maxHeight: 'none', visibility: 'hidden', pointerEvents: 'none' })
  el.parentElement.appendChild(clone)
  const fits = (f) => {
    clone.style.fontSize = `${f}px`
    const tol = Math.max(3, f * 0.12)
    return clone.scrollHeight <= limit + tol && clone.scrollWidth <= width + 2
  }
  let lo = min
  let hi = max
  let best
  if (fits(hi)) best = hi
  else if (!fits(lo)) {
    best = lo
    el.dataset.overflow = 'true'
  } else {
    while (hi - lo > step) {
      const mid = (lo + hi) / 2
      if (fits(mid)) lo = mid
      else hi = mid
    }
    best = lo
  }
  if (best !== lo || fits(best)) delete el.dataset.overflow
  clone.remove()
  el.style.fontSize = `${best}px`
  return best
}

/** Run every [data-fit] element inside root. data-fit="min,max". */
export function fitAll(root = document) {
  const els = root.querySelectorAll('[data-fit]')
  for (const el of els) {
    const [min, max] = String(el.dataset.fit).split(',').map(Number)
    fitText(el, { min: min || 13, max: max || 64 })
  }
}

/**
 * Split `text` into pages that fit `box` at its current font size. Measures
 * with a hidden mirror that copies the box's computed typography and width.
 * Breaks at sentence boundaries where possible, otherwise at words.
 */
export function paginateToFit(box, text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const mirror = document.createElement('div')
  const cs = getComputedStyle(box)
  for (const p of ['font', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'padding', 'boxSizing', 'textTransform']) mirror.style[p] = cs[p]
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.pointerEvents = 'none'
  mirror.style.left = '-99999px'
  mirror.style.top = '0'
  mirror.style.width = `${box.clientWidth}px`
  mirror.style.height = 'auto'
  mirror.style.whiteSpace = 'normal'
  mirror.style.overflowWrap = 'anywhere'
  document.body.appendChild(mirror)
  const limit = box.clientHeight
  const pages = []
  let i = 0
  while (i < words.length) {
    let lo = i + 1
    let hi = words.length
    // Largest j such that words[i..j) fits.
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      mirror.textContent = words.slice(i, mid).join(' ')
      if (mirror.scrollHeight <= limit + 1) lo = mid
      else hi = mid - 1
    }
    let j = lo
    // Prefer breaking after a sentence end if one exists in the back half.
    if (j < words.length) {
      for (let k = j - 1; k > i + Math.floor((j - i) / 2); k--) {
        if (/[.!?]["”’)]?$/.test(words[k])) {
          j = k + 1
          break
        }
      }
    }
    pages.push(words.slice(i, j).join(' '))
    i = j
  }
  mirror.remove()
  return pages
}

/**
 * How many characters of `sample` typography fit in `box` at its current font
 * size. Used to derive a dynamic maxlength for composers so a textarea can
 * never hold more than it can show.
 */
export function capacityOf(box, sampleText) {
  const text = sampleText && sampleText.length > 40 ? sampleText : 'The quick brown fox jumps over the lazy dog and keeps going until the line wraps. '
  const mirror = document.createElement('div')
  const cs = getComputedStyle(box)
  for (const p of ['font', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'padding', 'boxSizing', 'border']) mirror.style[p] = cs[p]
  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.left = '-99999px'
  mirror.style.width = `${box.clientWidth}px`
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'anywhere'
  document.body.appendChild(mirror)
  // Measure chars per line and lines per box.
  mirror.textContent = 'x'
  const lineH = mirror.scrollHeight || parseFloat(cs.lineHeight) || 20
  const padV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
  const lines = Math.max(1, Math.floor((box.clientHeight - padV) / lineH))
  let filler = text
  while (mirror.scrollHeight <= lineH * 2 && filler.length < 4000) {
    filler += text
    mirror.textContent = filler
  }
  // chars that fit in (lines) lines, estimated from average density.
  const charsPerLine = filler.length / Math.max(1, Math.round(mirror.scrollHeight / lineH))
  mirror.remove()
  return Math.max(20, Math.floor(charsPerLine * lines * 0.92))
}

/**
 * Overflow audit. Returns elements that would need scrolling: any element whose
 * scroll size exceeds its client size (unless overflow is visible and it is
 * not clipped), plus anything extending past the viewport.
 */
export function auditOverflow(root = document.documentElement) {
  const issues = []
  const vw = window.innerWidth
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight
  const doc = document.documentElement
  if (doc.scrollHeight > vh + 1 || doc.scrollWidth > vw + 1) {
    issues.push({ el: doc, kind: 'document', detail: `${doc.scrollWidth}x${doc.scrollHeight} vs ${vw}x${Math.round(vh)}` })
  }
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('.sr-only, [hidden], [aria-hidden="true"].measure')) continue
    // Intentional one-line / two-line previews whose full text is one action away.
    if (el.closest('[data-clamp]')) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const oy = cs.overflowY
    const ox = cs.overflowX
    const clipsY = oy === 'hidden' || oy === 'auto' || oy === 'scroll' || oy === 'clip'
    const clipsX = ox === 'hidden' || ox === 'auto' || ox === 'scroll' || ox === 'clip'
    // Glyphs may hang slightly outside the line box of large display type; that
    // is not scrollable content. Anything beyond ~12% of the font size is.
    const tol = Math.max(3, 0.12 * (parseFloat(cs.fontSize) || 16))
    if (clipsY && el.scrollHeight > el.clientHeight + tol) issues.push({ el, kind: 'clipped-y', detail: `${el.scrollHeight}>${el.clientHeight}` })
    if (clipsX && el.scrollWidth > el.clientWidth + tol) issues.push({ el, kind: 'clipped-x', detail: `${el.scrollWidth}>${el.clientWidth}` })
    if (el.tagName === 'TEXTAREA' && el.scrollHeight > el.clientHeight + 1) issues.push({ el, kind: 'textarea', detail: `${el.scrollHeight}>${el.clientHeight}` })
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0 && (r.bottom > vh + 1 || r.right > vw + 1 || r.left < -1 || r.top < -1)) {
      if (!el.closest('.measure')) issues.push({ el, kind: 'off-viewport', detail: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.right)},${Math.round(r.bottom)}` })
    }
  }
  return issues
}

/** Describe an element briefly for audit output. */
export function describe(el) {
  if (el === document.documentElement) return 'html'
  const id = el.id ? `#${el.id}` : ''
  const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
  return `${el.tagName.toLowerCase()}${id}${cls}`
}

/**
 * Keep --vvh (visual viewport height) current so the layout follows the
 * virtual keyboard and browser chrome. Calls onChange after each update.
 */
export function bindViewport(onChange) {
  const root = document.documentElement
  let last = -1
  const update = () => {
    const vv = window.visualViewport
    const h = Math.round(vv ? vv.height : window.innerHeight)
    const w = Math.round(vv ? vv.width : window.innerWidth)
    // A hidden or not-yet-laid-out tab reports 0×0; ignore it.
    if (h < 80 || w < 80) return
    if (h !== last) {
      root.style.setProperty('--vvh', `${h}px`)
      root.style.setProperty('--vvw', `${w}px`)
      root.dataset.short = h < 560 ? 'true' : 'false'
      root.dataset.tiny = h < 420 ? 'true' : 'false'
      root.dataset.unusable = h < 220 ? 'true' : 'false'
      last = h
      onChange?.(h, w)
    }
    // Some browsers scroll the page when the keyboard opens; undo it.
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0)
  }
  update()
  window.addEventListener('resize', update)
  window.visualViewport?.addEventListener('resize', update)
  window.visualViewport?.addEventListener('scroll', update)
  window.addEventListener('orientationchange', () => setTimeout(update, 60))
  return update
}
