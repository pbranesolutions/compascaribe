// Tiny DOM builder. No framework; views return real elements.

export function h(tag, props, ...children) {
  const el = document.createElement(tag)
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue
      if (k === 'class' || k === 'className') el.className = v
      else if (k === 'text') el.textContent = v
      else if (k === 'html') el.innerHTML = v
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
      else if (k === 'dataset') Object.assign(el.dataset, v)
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
      else if (k in el && typeof el[k] !== 'object' && k !== 'list') {
        try { el[k] = v } catch { el.setAttribute(k, v) }
      } else el.setAttribute(k, v === true ? '' : v)
    }
  }
  append(el, children)
  return el
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
  return el
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild)
  return el
}

export function qs(sel, root = document) {
  return root.querySelector(sel)
}
