// Spanish → English hint translation for the simulated qualifier.
//
// Many prospective customers will write in Spanish or Spanglish. The
// prototype's lexicon and copy are English, so before analysis we map common
// Spanish phrases to their English equivalents. This is a keyword bridge, not
// translation: it only has to make the feature extraction see the same
// signals. The visitor's original words are always kept and shown verbatim.
// A production Jev/Claude provider is multilingual and will not need this.

const PHRASES = [
  // intent
  ['quisiera', 'i would like'], ['quiero', 'i want'], ['queremos', 'we want'], ['necesito', 'i need'],
  ['necesitamos', 'we need'], ['me gustaría', 'i would like'], ['me gustaria', 'i would like'],
  ['nos gustaría', 'we would like'], ['nos gustaria', 'we would like'], ['busco', 'looking for'],
  ['buscamos', 'looking for'], ['tengo una idea', 'i have an idea'], ['ayuda para', 'help for'],
  ['ayudar a', 'help'], ['mejorar', 'improve'], ['automatizar', 'automate'], ['crear', 'create'],
  ['construir', 'build'], ['hacer', 'make'], ['desarrollar', 'develop'], ['organizar', 'organize'],
  ['controlar', 'track'], ['llevar el control de', 'track'], ['llevar control de', 'track'],
  // artifacts
  ['página web', 'website'], ['pagina web', 'website'], ['sitio web', 'website'], ['una web', 'a website'],
  ['aplicación', 'app'], ['aplicacion', 'app'], ['sistema', 'system'], ['plataforma', 'platform'],
  ['herramienta', 'tool'], ['tienda en línea', 'online store'], ['tienda en linea', 'online store'],
  ['tienda online', 'online store'], ['base de datos', 'database'], ['panel', 'dashboard'],
  ['formulario', 'form'], ['bot de whatsapp', 'whatsapp bot'], ['chatbot', 'chatbot'],
  // operations
  ['pedidos', 'orders'], ['pedido', 'order'], ['órdenes', 'orders'], ['ordenes', 'orders'],
  ['reservas', 'bookings'], ['reservaciones', 'reservations'], ['citas', 'appointments'], ['cita', 'appointment'],
  ['inventario', 'inventory'], ['facturas', 'invoices'], ['factura', 'invoice'], ['facturación', 'billing'],
  ['facturacion', 'billing'], ['cobros', 'payments'], ['pagos', 'payments'], ['nómina', 'payroll'], ['nomina', 'payroll'],
  ['clientes', 'customers'], ['cliente', 'customer'], ['pacientes', 'patients'], ['paciente', 'patient'],
  ['estudiantes', 'students'], ['alumnos', 'students'], ['padres', 'parents'], ['inquilinos', 'tenants'],
  ['huéspedes', 'guests'], ['huespedes', 'guests'], ['empleados', 'employees'], ['personal', 'staff'],
  ['equipo', 'team'], ['técnicos', 'technicians'], ['tecnicos', 'technicians'], ['choferes', 'drivers'],
  ['conductores', 'drivers'], ['entregas', 'deliveries'], ['envíos', 'shipments'], ['envios', 'shipments'],
  ['proveedores', 'suppliers'], ['donaciones', 'donations'], ['voluntarios', 'volunteers'], ['miembros', 'members'],
  ['socios', 'members'], ['turnos', 'shifts'], ['horarios', 'schedule'], ['agenda', 'schedule'],
  ['mantenimiento', 'maintenance'], ['cotizaciones', 'quotes'], ['cotización', 'quote'], ['cotizacion', 'quote'],
  ['presupuestos', 'estimates'], ['contratos', 'contracts'], ['documentos', 'documents'], ['ventas', 'sales'],
  ['productos', 'products'], ['catálogo', 'catalog'], ['catalogo', 'catalog'], ['menú', 'menu'], ['menu', 'menu'],
  ['mesas', 'tables'], ['habitaciones', 'rooms'], ['rutas', 'routes'], ['flota', 'fleet'], ['vehículos', 'vehicles'],
  ['vehiculos', 'vehicles'], ['asistencia', 'attendance'], ['inscripciones', 'enrollment'], ['matrícula', 'enrollment'],
  ['matricula', 'enrollment'], ['calificaciones', 'grades'], ['notas', 'grades'], ['solicitudes', 'requests'],
  ['reportes', 'reports'], ['informes', 'reports'], ['mensajes', 'messages'], ['llamadas', 'phone calls'],
  // pains
  ['perdemos', 'we lose track of'], ['se pierden', 'get missed'], ['se nos pierden', 'we lose track of'],
  ['a mano', 'by hand'], ['manualmente', 'manually'], ['hoja de cálculo', 'spreadsheet'], ['hoja de calculo', 'spreadsheet'],
  ['excel', 'excel'], ['cuaderno', 'notebook'], ['libreta', 'notebook'], ['papel', 'paper'], ['no sé', "don't know"],
  ['no se ', "don't know "], ['no sabemos', "don't know"], ['no tenemos visibilidad', 'no visibility'],
  ['copiar', 'copy'], ['copiarlos', 'copy them'], ['volver a escribir', 'retype'], ['se duplican', 'double booked'],
  ['doble reserva', 'double booked'], ['errores', 'errors'], ['error', 'error'], ['lento', 'slow'], ['tarda', 'slow'],
  ['desorden', 'chaos'], ['desordenado', 'disorganized'], ['caos', 'chaos'], ['sin control', 'no visibility'],
  ['se nos olvida', 'we forget'], ['se olvidan', 'forgotten'], ['agotado', 'out of stock'], ['sin stock', 'out of stock'],
  ['por whatsapp', 'over whatsapp'], ['por teléfono', 'by phone call'], ['por telefono', 'by phone call'],
  // outcomes
  ['ahorrar tiempo', 'save time'], ['más rápido', 'faster'], ['mas rapido', 'faster'], ['menos errores', 'fewer errors'],
  ['crecer', 'grow'], ['vender más', 'more sales'], ['vender mas', 'more sales'], ['en un solo lugar', 'in one place'],
  ['en tiempo real', 'real time'], ['sin llamar', 'without calling'], ['automático', 'automatic'], ['automatico', 'automatic'],
  ['ellos mismos', 'themselves'], ['por su cuenta', 'on their own'],
  // organizations / domains
  ['restaurante', 'restaurant'], ['cafetería', 'cafe'], ['cafeteria', 'cafe'], ['panadería', 'bakery'], ['panaderia', 'bakery'],
  ['cocina', 'kitchen'], ['hotel', 'hotel'], ['villa', 'villa'], ['tienda', 'store'], ['colmado', 'store'],
  ['ferretería', 'hardware store'], ['ferreteria', 'hardware store'], ['farmacia', 'pharmacy'], ['clínica', 'clinic'],
  ['clinica', 'clinic'], ['consultorio', 'clinic'], ['dentista', 'dentist'], ['escuela', 'school'], ['colegio', 'school'],
  ['academia', 'academy'], ['universidad', 'university'], ['iglesia', 'church'], ['fundación', 'foundation'],
  ['fundacion', 'foundation'], ['cooperativa', 'cooperative'], ['negocio', 'business'], ['empresa', 'company'],
  ['oficina', 'office'], ['taller', 'workshop'], ['fábrica', 'factory'], ['fabrica', 'factory'], ['finca', 'farm'],
  ['agencia', 'agency'], ['bufete', 'law firm'], ['abogados', 'lawyers'], ['contador', 'accountant'],
  ['constructora', 'construction company'], ['inmobiliaria', 'real estate agency'], ['alquiler', 'rental'],
  ['alquileres', 'rentals'], ['excursiones', 'excursions'], ['excursión', 'excursion'], ['tours', 'tours'],
  ['turistas', 'tourists'], ['guías', 'guides'], ['guias', 'guides'], ['transporte', 'transport'],
  ['ayuntamiento', 'municipality'], ['gobierno', 'government'], ['ciudadanos', 'citizens'], ['salón', 'salon'],
  ['salon', 'salon'], ['gimnasio', 'gym'], ['eventos', 'events'], ['bodas', 'weddings'],
  // connectives / determiners
  ['para que', 'so that'], ['para mi', 'for my'], ['para mí', 'for my'], ['para nuestra', 'for our'],
  ['para nuestro', 'for our'], ['para la', 'for the'], ['para el', 'for the'], ['de mi', 'of my'], ['de nuestra', 'of our'],
  ['de nuestro', 'of our'], ['nuestra', 'our'], ['nuestro', 'our'], ['nuestros', 'our'], ['nuestras', 'our'],
  ['los ', 'the '], ['las ', 'the '], ['una ', 'a '], ['un ', 'a '], ['el ', 'the '], ['la ', 'the '],
  ['que ', 'that '], ['y ', 'and '], ['con ', 'with '], ['sin ', 'without '], ['porque', 'because'],
  ['tengo', 'i have'], ['tenemos', 'we have'], ['somos', 'we are'], ['soy', 'i am'], ['hola', 'hello'],
]

// Longest phrases first so "página web" wins over "página".
const ORDERED = [...PHRASES].sort((a, b) => b[0].length - a[0].length)
const RE = new RegExp(ORDERED.map(([es]) => `(?<![\\p{L}])${es.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`).join('|'), 'giu')
const MAP = new Map(ORDERED.map(([es, en]) => [es.toLowerCase(), en]))

const SPANISH_MARKERS = /\b(quiero|quisiera|necesito|necesitamos|para que|tengo|tenemos|pedidos|clientes|negocio|empresa|citas|una app|página|pagina|sistema|hola|perdemos|nuestra|nuestro)\b/i

/** True when the text reads as (at least partly) Spanish. */
export function looksSpanish(text) {
  return SPANISH_MARKERS.test(String(text || ''))
}

/**
 * Replace known Spanish phrases with English keyword equivalents. Only applied
 * when the text looks Spanish, so English text is never touched.
 */
export function translateHints(text) {
  const t = String(text || '')
  if (!looksSpanish(t)) return t
  return t.replace(RE, (m) => {
    const key = m.toLowerCase()
    const hit = MAP.get(key) ?? MAP.get(key.trim()) ?? m
    // Preserve trailing space captured by determiner patterns like "los ".
    return key.endsWith(' ') && !hit.endsWith(' ') ? hit + ' ' : hit
  })
}
