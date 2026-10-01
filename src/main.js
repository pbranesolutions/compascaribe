import './style.css'

// Simulated Decision Channel. Nothing is saved or sent anywhere.

const stage = document.querySelector('#stage')
const live = document.querySelector('#live')
const composeSnapshot = stage.innerHTML
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

let state = null
let lock = false
let timer = 0

const scenarios = {
  equipo: {
    questions: [
      {
        category: 'Objetivo',
        prompt: '¿Qué debería mejorar primero?',
        example: 'Por ejemplo: dejar de llamar a cada técnico para saber si puede salir.',
        options: [
          'Saber quién está disponible ahora',
          'Asignar un trabajo sin perseguir a nadie',
          'Que el cliente vea el estado sin preguntar'
        ]
      },
      {
        category: 'Usuarios',
        prompt: '¿Quién toma hoy la decisión de a quién enviar?',
        example: 'Una persona, el técnico, o depende del día.',
        options: [
          'Quien coordina el equipo',
          'El técnico, cuando puede',
          'Depende de quién esté al tanto'
        ]
      },
      {
        category: 'Proceso actual',
        prompt: '¿Dónde vive esa información ahora?',
        example: 'Si hoy hay que preguntarlo, todavía no está en un solo lugar.',
        options: [
          'En WhatsApp y llamadas',
          'En la cabeza de una persona',
          'En una hoja que se desactualiza'
        ]
      },
      {
        category: 'Nuevo proceso',
        prompt: 'Cuando llega un trabajo, ¿qué debería pasar?',
        example: 'El primer uso concreto. Lo demás puede esperar.',
        options: [
          'Ver disponibilidad y asignar en el momento',
          'Proponer una asignación y confirmarla',
          'Dejar que el técnico acepte el trabajo'
        ]
      }
    ],
    pending: [
      {
        prompt: '¿El cliente puede ver quién va en camino?',
        options: [
          'Sí. Ve el estado, sin detalles internos.',
          'No. Solo lo ve quien coordina.'
        ]
      },
      {
        prompt: '¿Qué pasa si nadie está disponible?',
        options: [
          'El trabajo queda en espera, visible.',
          'Se avisa a quien coordina.'
        ]
      }
    ]
  },
  pedidos: {
    questions: [
      {
        category: 'Objetivo',
        prompt: '¿Qué se daña cuando el pedido se copia a mano?',
        example: 'Alguien escribe por WhatsApp. Otra persona lo vuelve a escribir.',
        options: [
          'Se pierde tiempo',
          'El pedido llega mal',
          'Nadie sabe qué ya se atendió'
        ]
      },
      {
        category: 'Usuarios',
        prompt: '¿Quién recibe esos mensajes?',
        example: 'Quien abre el chat no siempre es quien prepara el pedido.',
        options: [
          'Una sola persona',
          'Varias personas en el mismo chat',
          'Quien esté disponible en ese momento'
        ]
      },
      {
        category: 'Proceso actual',
        prompt: '¿Dónde termina el pedido hoy?',
        example: 'El chat no es el mismo lugar donde se prepara.',
        options: [
          'En un cuaderno o una hoja',
          'En la memoria de quien prepara',
          'Se queda en el chat'
        ]
      },
      {
        category: 'Nuevo proceso',
        prompt: '¿Qué debería quedar listo sin volver a copiarlo?',
        example: 'Lo mínimo para que alguien pueda actuar.',
        options: [
          'Productos y cantidades',
          'Cliente y cómo entregarlo',
          'El pedido completo, listo para preparar'
        ]
      }
    ],
    pending: [
      {
        prompt: '¿El cliente confirma antes de prepararlo?',
        options: [
          'Sí, con un mensaje breve.',
          'No, si el pedido está completo.'
        ]
      },
      {
        prompt: '¿Qué pasa con un pedido incompleto?',
        options: [
          'Se pregunta lo que falta.',
          'Queda marcado, sin preparar.'
        ]
      }
    ]
  },
  idea: {
    questions: [
      {
        category: 'Objetivo',
        prompt: '¿Para quién es, aunque el resto no esté claro?',
        example: 'No hace falta explicar la aplicación. Solo quién la usaría.',
        options: [
          'Para mis clientes',
          'Para mi equipo',
          'Para operar el negocio con más claridad'
        ]
      },
      {
        category: 'Usuarios',
        prompt: '¿Qué debería poder hacer esa persona?',
        example: 'Un solo gesto. El primer uso.',
        options: [
          'Resolver algo que hoy toma demasiado',
          'Ver información que hoy está dispersa',
          'Registrar un pedido, una solicitud o un dato'
        ]
      },
      {
        category: 'Proceso actual',
        prompt: '¿Qué ya tienes claro?',
        example: 'Está bien si la respuesta es casi nada.',
        options: [
          'El problema',
          'Quién la usaría',
          'Casi nada todavía'
        ]
      },
      {
        category: 'Nuevo proceso',
        prompt: '¿Por dónde seguimos?',
        example: 'Elegir un siguiente paso es una decisión.',
        options: [
          'Definir el primer uso concreto',
          'Describir un día normal con la aplicación',
          'Dejar por escrito lo que no debe hacer'
        ]
      }
    ],
    pending: [
      {
        prompt: '¿Cuál es ese primer uso, en una frase?',
        options: [
          'Entrar y dejar algo registrado.',
          'Entrar y ver qué necesita atención.'
        ]
      },
      {
        prompt: '¿Qué preferimos no decidir todavía?',
        options: [
          'Cómo se ve en detalle.',
          'Quién más entra después.'
        ]
      }
    ]
  },
  oportunidad: {
    questions: [
      {
        category: 'Objetivo',
        prompt: '¿Quién siente hoy esa oportunidad?',
        example: 'Si nadie la está resolviendo, igual hay alguien que la padece.',
        options: [
          'Negocios como el mío',
          'Un cliente que hoy no tiene cómo hacerlo',
          'Todavía no está claro'
        ]
      },
      {
        category: 'Usuarios',
        prompt: '¿Qué hacen esas personas ahora?',
        example: 'El hueco se entiende por lo que usan en su lugar.',
        options: [
          'Lo resuelven con llamadas y mensajes',
          'Usan algo que no les sirve',
          'No lo hacen. No hay con qué.'
        ]
      },
      {
        category: 'Proceso actual',
        prompt: '¿Qué tendría que existir para que valga la pena?',
        example: 'No la plataforma completa. El primer caso.',
        options: [
          'Un primer paso muy simple',
          'Una vista clara de lo que hoy está disperso',
          'Una forma de coordinar ese trabajo'
        ]
      },
      {
        category: 'Nuevo proceso',
        prompt: '¿Qué ya puedes afirmar?',
        example: 'Una intuición también cuenta, si la dejamos escrita.',
        options: [
          'El problema es real',
          'Sé quién lo usaría',
          'Solo tengo la intuición. Quiero definirla.'
        ]
      }
    ],
    pending: [
      {
        prompt: '¿Cuál es el primer caso concreto?',
        options: [
          'Un negocio, un día, una tarea.',
          'Todavía es un sector, no un caso.'
        ]
      },
      {
        prompt: '¿Quién decidiría usarlo primero?',
        options: [
          'Quien opera el día a día.',
          'Quien dirige y quiere ver el resultado.'
        ]
      }
    ]
  },
  automatizar: {
    questions: [
      {
        category: 'Objetivo',
        prompt: '¿Qué es lo que hoy se hace a mano?',
        example: 'El trabajo repetido, no la herramienta que lo reemplaza.',
        options: [
          'Coordinar personas',
          'Pasar información de un lugar a otro',
          'Repetir los mismos pasos cada día'
        ]
      },
      {
        category: 'Usuarios',
        prompt: '¿Quién carga con ese trabajo?',
        example: 'Quien lo hace hoy es quien siente el cambio.',
        options: [
          'Una persona que ya tiene demasiado',
          'Varias, y cada una lo hace distinto',
          'Quien pueda, cuando puede'
        ]
      },
      {
        category: 'Proceso actual',
        prompt: '¿Qué se pierde en el camino?',
        example: 'Tiempo, un dato, o saber en qué va.',
        options: [
          'Tiempo',
          'Detalles',
          'Saber en qué va la cosa'
        ]
      },
      {
        category: 'Nuevo proceso',
        prompt: '¿Qué debería ocurrir en su lugar?',
        example: 'El paso que ya no hay que rehacer.',
        options: [
          'Quedar registrado en el momento',
          'Pasar al siguiente paso sin reescribirlo',
          'Verse claro para quien tiene que actuar'
        ]
      }
    ],
    pending: [
      {
        prompt: '¿Qué paso sigue siendo manual, a propósito?',
        options: [
          'La confirmación de una persona.',
          'Ninguno, si el dato ya está completo.'
        ]
      },
      {
        prompt: '¿Quién debe ver que ya quedó hecho?',
        options: [
          'Quien lo pidió.',
          'Quien opera el siguiente paso.'
        ]
      }
    ]
  },
  general: {
    questions: [
      {
        category: 'Objetivo',
        prompt: '¿Qué debería quedar mejor?',
        example: 'No tiene que ser la solución. Solo el resultado que buscas.',
        options: [
          'Menos tiempo en lo manual',
          'Más claridad para quien opera',
          'Una forma de hacer algo que hoy no existe'
        ]
      },
      {
        category: 'Usuarios',
        prompt: '¿Quién lo va a usar?',
        example: 'Puede ser más de una persona, con cosas distintas.',
        options: [
          'Quien opera el día a día',
          'Los clientes',
          'Las dos partes, con cosas distintas'
        ]
      },
      {
        category: 'Proceso actual',
        prompt: '¿Cómo se resuelve hoy?',
        example: 'Si no hay proceso, eso también es una respuesta.',
        options: [
          'Con mensajes, llamadas y memoria',
          'Con hojas o herramientas que no se hablan',
          'Todavía no hay un proceso. Es una idea.'
        ]
      },
      {
        category: 'Nuevo proceso',
        prompt: '¿Qué debería pasar en el primer uso?',
        example: 'Una persona entra. ¿Qué hace?',
        options: [
          'Ve lo importante y actúa',
          'Un mensaje se convierte en algo ordenado',
          'Queda registrado lo que hoy se pierde'
        ]
      }
    ],
    pending: [
      {
        prompt: '¿Qué no debería hacer esta aplicación?',
        options: [
          'Intentar cubrir todo desde el inicio.',
          'Decidir sin que una persona confirme.'
        ]
      },
      {
        prompt: '¿Quién confirma que algo quedó bien?',
        options: [
          'Quien opera.',
          'El cliente.'
        ]
      }
    ]
  }
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag)
  Object.entries(attrs).forEach(([key, value]) => {
    if (value == null || value === false) return
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else node.setAttribute(key, value)
  })
  children.flat().forEach((child) => {
    if (child == null || child === false) return
    node.append(child)
  })
  return node
}

function scenario() {
  return scenarios[state.scenarioId]
}

function detectScenario(text) {
  const value = text.toLowerCase()
  if (/whatsapp|pedido/.test(value)) return 'pedidos'
  if (/idea|no sé|no se|cómo debería|como deberia/.test(value)) return 'idea'
  if (/oportunidad|industria|nadie está|nadie esta/.test(value)) return 'oportunidad'
  if (/coordin|equipo|técnic|tecnic|asign|disponib/.test(value)) return 'equipo'
  if (/automatiz/.test(value)) return 'automatizar'
  return 'general'
}

function answerFor(category) {
  return state.answers.find((item) => item.category === category)?.value || ''
}

function setLive(message) {
  live.textContent = ''
  live.textContent = message
}

function showError(message) {
  const note = stage.querySelector('#composer-error')
  const area = stage.querySelector('#problem')
  if (note) {
    note.hidden = false
    note.textContent = message
  }
  if (area) {
    area.setAttribute('aria-invalid', 'true')
    area.setAttribute('aria-describedby', 'composer-error')
    area.focus()
  }
}

function clearError() {
  const note = stage.querySelector('#composer-error')
  const area = stage.querySelector('#problem')
  if (note) note.hidden = true
  if (area) {
    area.removeAttribute('aria-invalid')
    area.removeAttribute('aria-describedby')
  }
}

function bindField(form, area, onSubmit) {
  if (!form || !area) return
  area.addEventListener('input', () => {
    clearError()
    document.body.classList.toggle('is-saying', area.value.trim().length > 0)
  })
  let lastCompositionEndAt = null
  area.addEventListener('compositionend', (event) => {
    lastCompositionEndAt = event.timeStamp
  })
  area.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (event.isComposing || event.keyCode === 229) return
    if (
      lastCompositionEndAt !== null &&
      Math.abs(event.timeStamp - lastCompositionEndAt) < 50
    ) return
    form.requestSubmit()
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = area.value.trim()
    if (!text) {
      showError('Escribe una frase, aunque sea incompleta.')
      return
    }
    onSubmit(text)
  })
}

function bindCompose() {
  bindField(stage.querySelector('#composer'), stage.querySelector('#problem'), startChannel)
}

function showCompose() {
  window.clearTimeout(timer)
  lock = false
  state = null
  document.body.classList.remove('is-working', 'is-saying')
  stage.classList.remove('is-channel')
  stage.innerHTML = composeSnapshot
  bindCompose()
  const area = stage.querySelector('#problem')
  if (area) area.focus({ preventScroll: true })
}

function startChannel(text) {
  window.clearTimeout(timer)
  lock = false
  const scenarioId = detectScenario(text)
  state = {
    origin: text,
    scenarioId,
    phase: 'question',
    step: 0,
    answers: [],
    pending: scenarios[scenarioId].pending.map((item) => ({ ...item, options: [...item.options] }))
  }
  document.body.classList.remove('is-saying', 'is-working')
  stage.classList.remove('is-channel')
  render()
  setLive('Decision Channel empezó. Primera pregunta.')
}

function tickRow(filled) {
  const total = scenario().questions.length
  const meter = el('div', {
    class: 'ticks',
    role: 'img',
    'aria-label': `${filled} de ${total}`
  })
  for (let index = 0; index < total; index += 1) {
    meter.append(el('span', { class: index < filled ? 'tick is-on' : 'tick' }))
  }
  return meter
}

function answerForm(onSubmit) {
  const note = el('p', { id: 'composer-error', class: 'error', hidden: '' })
  note.hidden = true
  const area = el('textarea', {
    id: 'problem',
    name: 'problem',
    rows: '2',
    maxlength: '800',
    lang: 'es',
    enterkeyhint: 'send'
  })
  const form = el('form', { id: 'composer', action: '#stage', method: 'get' }, [
    el('label', { class: 'sr-only', for: 'problem', text: 'Tu respuesta' }),
    el('div', { class: 'composer' }, [
      area,
      el('button', { type: 'submit', class: 'send' }, [
        el('span', { class: 'sr-only', text: 'Registrar' })
      ])
    ]),
    note
  ])
  bindField(form, area, onSubmit)
  return form
}


function restartControl() {
  return el('button', {
    type: 'button',
    class: 'linkish',
    text: 'Empezar de nuevo'
  })
}

function wireRestart(root) {
  root.querySelectorAll('.linkish').forEach((button) => {
    if (button.textContent === 'Empezar de nuevo') {
      button.addEventListener('click', showCompose)
    }
  })
}


function choose(value, button) {
  if (lock) return
  lock = true
  button.classList.add('is-chosen')
  const question = scenario().questions[state.step]
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    lock = false
    if (!state || state.phase !== 'question') return
    state.answers.push({
      category: question.category,
      prompt: question.prompt,
      value
    })
    if (state.step < scenario().questions.length - 1) {
      state.step += 1
      setLive(`${question.category} quedó registrado. Siguiente pregunta.`)
      render()
    } else {
      state.phase = 'board'
      setLive('Las decisiones pasaron al tablero.')
      render()
    }
  }, reduceMotion ? 0 : 260)
}

function renderQuestion() {
  const question = scenario().questions[state.step]
  const form = answerForm((text) => choose(text, form.querySelector('.send')))
  const area = form.querySelector('#problem')
  const choices = el('div', { class: 'answers', role: 'group', 'aria-labelledby': 'page-title' })
  const mark = () => {
    const value = area.value.trim()
    choices.querySelectorAll('.answer').forEach((item) => {
      const selected = item.textContent === value
      item.classList.toggle('is-selected', selected)
      item.setAttribute('aria-pressed', selected ? 'true' : 'false')
    })
  }
  question.options.forEach((option) => {
    const button = el('button', {
      type: 'button',
      class: 'answer',
      text: option,
      'aria-pressed': 'false'
    })
    button.addEventListener('click', () => {
      area.value = option
      area.dispatchEvent(new Event('input', { bubbles: true }))
      mark()
      area.focus({ preventScroll: true })
    })
    choices.append(button)
  })
  area.addEventListener('input', mark)

  const view = el('div', { class: 'frame' }, [
    tickRow(state.step),
    el('h1', { id: 'page-title', text: question.prompt }),
    choices,
    form,
    el('div', { class: 'frame-foot' }, [restartControl()])
  ])
  stage.replaceChildren(view)
  wireRestart(view)
  area.focus({ preventScroll: true })
}


function resolvePending(value, button) {
  if (lock || !state.pending.length) return
  lock = true
  button.classList.add('is-chosen')
  const item = state.pending[0]
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    lock = false
    if (!state) return
    state.answers.push({
      category: 'Decisiones',
      prompt: item.prompt,
      value
    })
    state.pending.shift()
    setLive('Esa pregunta pasó a decisiones.')
    render()
  }, reduceMotion ? 0 : 260)
}

function renderBoard() {
  const categories = ['Objetivo', 'Usuarios', 'Proceso actual', 'Nuevo proceso']
  const lines = el('dl', { class: 'decisions' })
  categories.forEach((category) => {
    lines.append(el('div', {}, [
      el('dt', { text: category }),
      el('dd', { text: answerFor(category) })
    ]))
  })

  const later = state.pending.slice(1).map((item) => el('li', { text: item.prompt }))
  const follow = state.pending[0]
    ? el('div', { class: 'pending' }, [
      el('p', { class: 'pending-q', text: state.pending[0].prompt }),
      el('div', { class: 'answers' }, state.pending[0].options.map((option) => {
        const button = el('button', { type: 'button', class: 'answer', text: option })
        button.addEventListener('click', () => resolvePending(option, button))
        return button
      })),
      later.length ? el('ul', { class: 'pending-note' }, later) : null
    ])
    : el('p', { class: 'pending-note', text: 'Nada pendiente en este recorrido.' })

  const view = el('div', { class: 'frame frame-board' }, [
    tickRow(scenario().questions.length),
    lines,
    follow,
    el('div', { class: 'frame-foot' }, [
      el('button', { type: 'button', class: 'text-btn', id: 'see-app', text: 'Ver cómo se vería' }),
      restartControl()
    ])
  ])
  stage.replaceChildren(view)
  view.querySelector('#see-app').addEventListener('click', () => {
    state.phase = 'app'
    setLive('Boceto de la aplicación, a partir de lo decidido.')
    render()
  })
  wireRestart(view)
}


function row(left, right, ok) {
  return el('li', {}, [
    el('span', { text: left }),
    el('span', { class: ok ? 'ok' : '', text: right })
  ])
}

function shell(title, tag, body, wide) {
  return el('div', { class: wide ? 'app-shell is-wide' : 'app-shell' }, [
    el('div', { class: 'app-bar' }, [
      el('span', { text: title }),
      el('span', { class: 'sketch-tag', text: tag })
    ]),
    body
  ])
}

function renderSketch() {
  const id = state.scenarioId
  const pendingNote = state.pending[0]?.prompt

  if (id === 'equipo') {
    const clientSees = state.answers.some((item) => (
    /cliente/i.test(`${item.prompt} ${item.value}`) && /sí|estado/i.test(item.value)
  ))
    const waiting = state.answers.some((item) => /espera/i.test(item.value))
    return shell('Asignación de hoy', 'Boceto', el('div', { class: 'app-body' }, [
      el('ul', { class: 'sketch-list' }, [
        row('Luis', 'Disponible', true),
        row('Ana', 'En un trabajo'),
        row('Carlos', 'Disponible', true)
      ]),
      el('div', { class: 'sketch-job' }, [
        el('span', { text: 'Mantenimiento · Piantini' }),
        el('span', { class: 'sketch-tag', text: waiting ? 'En espera' : 'Sin asignar' })
      ]),
      clientSees ? el('p', { class: 'example', text: 'El cliente ve el estado. No ve el detalle interno.' }) : null,
      pendingNote ? el('p', { class: 'example', text: `Sigue abierto: ${pendingNote}` }) : null
    ]))
  }

  if (id === 'pedidos') {
    const confirm = state.answers.some((item) => /mensaje breve/i.test(item.value))
    const incomplete = state.answers.some((item) => /incompleto|sin preparar|lo que falta/i.test(item.value))
    const status = confirm ? 'Espera confirmación' : incomplete ? 'Incompleto' : 'Listo para preparar'
    return shell('Pedidos', 'Boceto', el('div', { class: 'app-columns' }, [
      el('div', {}, [
        el('p', { class: 'app-label', text: 'WhatsApp' }),
        el('p', { class: 'bubble', text: 'Hola, quiero 2 libras de yuca y 1 pollo. Me lo llevas a Gazcue.' })
      ]),
      el('div', {}, [
        el('p', { class: 'app-label', text: 'Pedido' }),
        el('ul', { class: 'sketch-list' }, [
          row('Yuca', '2 lb'),
          row('Pollo', '1'),
          row('Entrega', 'Gazcue'),
          row('Estado', status, status.startsWith('Listo'))
        ]),
        pendingNote ? el('p', { class: 'example', text: `Sigue abierto: ${pendingNote}` }) : null
      ])
    ]), true)
  }

  if (id === 'automatizar') {
    return shell('El paso que se repetía', 'Boceto', el('div', { class: 'app-columns' }, [
      el('div', {}, [
        el('p', { class: 'app-label', text: 'Antes' }),
        el('ul', { class: 'sketch-list before' }, [
          el('li', { text: 'Recibir el dato' }),
          el('li', { text: 'Volver a escribirlo' }),
          el('li', { text: 'Preguntar en qué va' })
        ])
      ]),
      el('div', {}, [
        el('p', { class: 'app-label', text: 'Ahora' }),
        el('p', { text: answerFor('Nuevo proceso') }),
        el('p', { class: 'example', text: answerFor('Objetivo') }),
        pendingNote ? el('p', { class: 'example', text: `Sigue abierto: ${pendingNote}` }) : null
      ])
    ]), true)
  }

  const title = id === 'idea' ? 'Primer uso' : id === 'oportunidad' ? 'Primer caso' : 'Boceto'
  return shell(title, 'Boceto', el('div', { class: 'app-body' }, [
    el('p', { text: state.origin }),
    el('ul', { class: 'sketch-list' }, [
      row('Objetivo', answerFor('Objetivo')),
      row('Quién', answerFor('Usuarios')),
      row('Primer uso', answerFor('Nuevo proceso'))
    ]),
    pendingNote
      ? el('p', { class: 'example', text: `Sigue abierto: ${pendingNote}` })
      : el('p', { class: 'example', text: 'Este recorrido ya no tiene preguntas abiertas.' })
  ]))
}

function renderApp() {
  const view = el('div', { class: 'frame frame-sketch' }, [
    tickRow(scenario().questions.length),
    el('h1', { id: 'page-title', text: 'Así podría empezar' }),
    renderSketch(),
    el('div', { class: 'frame-foot' }, [
      el('button', { type: 'button', class: 'text-btn', id: 'back-board', text: 'Volver al tablero' }),
      restartControl()
    ])
  ])
  stage.replaceChildren(view)
  view.querySelector('#back-board').addEventListener('click', () => {
    state.phase = 'board'
    render()
  })
  wireRestart(view)
}

function render() {
  if (!state) return
  if (state.phase === 'question') renderQuestion()
  else if (state.phase === 'board') renderBoard()
  else renderApp()
}

function init() {
  bindCompose()

  document.addEventListener('click', (event) => {
    const fill = event.target.closest('[data-fill]')
    if (fill) {
      const area = document.querySelector('#problem')
      if (!area) return
      area.value = fill.dataset.fill
      area.dispatchEvent(new Event('input', { bubbles: true }))
      area.focus()
      return
    }
    const start = event.target.closest('[data-start]')
    if (start) startChannel(start.dataset.start)
  })

  const brand = document.querySelector('#brand')
  if (brand) {
    brand.addEventListener('click', (event) => {
      if (!stage.classList.contains('is-channel')) return
      event.preventDefault()
      showCompose()
    })
  }

  const dialog = document.querySelector('#login-dialog')
  const loginOpen = document.querySelector('#login-open')
  if (dialog && loginOpen) {
    const email = document.querySelector('#login-email')
    const note = document.querySelector('#login-note')
    loginOpen.addEventListener('click', () => {
      note.hidden = true
      dialog.showModal()
      email.focus()
    })
    document.querySelector('#login-enter').addEventListener('click', () => {
      note.hidden = false
    })
    email.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      note.hidden = false
    })
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close()
    })
    dialog.addEventListener('close', () => {
      note.hidden = true
      email.value = ''
    })
  }
}

init()
