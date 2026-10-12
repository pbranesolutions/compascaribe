// Lexicon for the simulated qualification layer.
//
// This is the stand-in for Jev (the inexpensive classification model that
// will eventually sit in front of generative inference). Everything here is
// deterministic and intentionally transparent. When Jev is integrated, the
// classifier module keeps the same output shape and this file becomes
// unnecessary.
//
// Phrases are plain strings. Multi-word phrases match as a sequence of words;
// single words match with light suffix tolerance (s, es, ed, ing).

export const BUILD_VERBS = [
  'build', 'create', 'develop', 'make', 'design', 'launch', 'set up', 'setup',
  'automate', 'digitize', 'digitise', 'replace', 'improve', 'streamline',
  'modernize', 'modernise', 'implement', 'integrate', 'connect', 'migrate',
  'need', 'want', 'looking for', 'help us', 'help me', 'would like', 'wish we had',
  'idea for', 'thinking about', 'trying to', 'figure out',
]

export const ARTIFACTS = [
  'app', 'application', 'website', 'site', 'web app', 'webapp', 'mobile app',
  'platform', 'system', 'tool', 'software', 'dashboard', 'portal', 'database',
  'bot', 'chatbot', 'assistant', 'agent', 'automation', 'workflow', 'crm', 'erp',
  'pos', 'point of sale', 'booking system', 'scheduler', 'marketplace',
  'online store', 'e-commerce', 'ecommerce', 'api', 'integration', 'form',
  'intranet', 'kiosk', 'landing page', 'calendar', 'tracker', 'spreadsheet',
  'program', 'solution', 'prototype', 'mvp', 'saas', 'plugin', 'extension',
  'notification', 'alerts', 'reminders', 'reports', 'reporting',
]

export const OPERATIONS = [
  'order', 'booking', 'reservation', 'appointment', 'schedule', 'scheduling',
  'inventory', 'stock', 'invoice', 'invoicing', 'billing', 'payment', 'payroll',
  'customer', 'client', 'lead', 'quote', 'estimate', 'delivery', 'dispatch',
  'route', 'driver', 'technician', 'staff', 'employee', 'shift', 'ticket',
  'request', 'maintenance', 'work order', 'tenant', 'member', 'student',
  'patient', 'donor', 'volunteer', 'vendor', 'supplier', 'purchase order',
  'menu', 'table', 'guest', 'check in', 'check-in', 'tracking', 'attendance',
  'enrollment', 'grade', 'loyalty', 'review', 'catalog', 'catalogue', 'product',
  'listing', 'contract', 'document', 'approval', 'compliance', 'onboarding',
  'training', 'sale', 'sales', 'subscription', 'rental', 'property', 'unit',
  'fleet', 'vehicle', 'equipment', 'asset', 'jobs', 'job site', 'service job', 'project', 'task', 'case',
  'claim', 'application', 'registration', 'event', 'class', 'session', 'visit',
  'parcel', 'shipment', 'warehouse', 'supply', 'recipe', 'production', 'batch',
  'crop', 'harvest', 'livestock', 'donation', 'campaign', 'volunteer',
  'timesheet', 'hours', 'expense', 'receipt', 'budget', 'report', 'data',
  'inquiry', 'enquiry', 'message', 'chat', 'referral', 'waitlist', 'queue',
]

export const PAINS = [
  'manual', 'manually', 'by hand', 'spreadsheet', 'excel', 'google sheet',
  'google sheets', 'whatsapp', 'text message', 'texts', 'phone call', 'phone calls',
  'calling', 'paper', 'notebook', 'back and forth', 'double entry', 'retype',
  're-type', 'copy', 'copying', 'lose track', 'losing track', 'fall through the cracks',
  'falls through the cracks', 'missed', 'missing', 'forget', 'forgotten', 'mistake',
  'error', 'slow', 'takes hours', 'takes forever', 'waste', 'wasting', 'no visibility',
  'dont know', "don't know", 'no idea', 'cant see', "can't see", 'cannot see',
  'chaos', 'chaotic', 'messy', 'mess', 'disorganized', 'disorganised', 'late',
  'delay', 'overbooked', 'double booked', 'double-booked', 'double book', 'double books', 'double booking', 'double-booking', 'no show', 'no-show',
  'out of stock', 'bottleneck', 'frustrating', 'painful', 'nightmare', 'headache',
  'overwhelmed', 'overwhelming', 'too many', 'tedious', 'repetitive', 'scattered',
  'all over the place', 'inconsistent', 'unreliable', 'broken', 'outdated',
  'legacy', 'clunky', 'hard to', 'difficult to', 'impossible to', 'struggle',
  'struggling', 'problem', 'issue', 'pain', 'confusion', 'confusing',
  'never know', 'no way to know', 'until a customer complains', 'complain', 'complaint',
  'complaints', 'run out', 'runs out', 'running out', 'ran out', 'walk the aisles',
  'walking the aisles', 'chasing', 'chase', 'keep asking', 'keeps asking', 'keep calling',
  'keeps calling', 'from memory', 'in my head', 'in his head', 'in her head', 'sticky notes',
  'post-its', 'text me', 'texts me', 'call me', 'calls me',
]

export const OUTCOMES = [
  'save time', 'saves time', 'faster', 'quicker', 'fewer errors', 'less errors',
  'grow', 'growth', 'scale', 'more sales', 'more customers', 'more clients',
  'visibility', 'at a glance', 'in one place', 'one place', 'real time', 'real-time',
  'self service', 'self-service', 'automatic', 'automatically', 'reliable',
  'consistent', 'reduce cost', 'cut costs', 'cheaper', 'better experience',
  'happier', 'easier', 'simpler', 'organized', 'organised', 'on time', 'accurate',
  'without me', 'themselves', 'on their own', 'free up', 'stop', 'never miss',
  'know where', 'know what', 'know who', 'single source', 'source of truth',
  'peace of mind', 'professional', 'efficient', 'efficiency', 'productive',
  'transparent', 'transparency', 'accountable', 'accountability', 'insight',
  'decisions', 'profitable', 'revenue', 'retention', 'loyal',
]

export const SCALE = [
  'team', 'employees', 'staff', 'people', 'locations', 'branches', 'stores',
  'warehouses', 'clients', 'customers', 'revenue', 'monthly', 'per week',
  'per day', 'a week', 'a day', 'a month', 'company', 'business', 'organization',
  'organisation', 'agency', 'firm', 'clinic', 'restaurant', 'hotel', 'school',
  'nonprofit', 'non-profit', 'church', 'cooperative', 'co-op', 'government',
  'municipality', 'startup', 'founder', 'owner', 'we', 'our', 'us',
]

// Domains: label, the noun we use to refer back to the customer's operation,
// and the words that reveal it.
export const DOMAINS = [
  { id: 'hospitality', noun: 'restaurant', plural: 'guests', actors: 'guests', words: ['restaurant', 'cafe', 'café', 'bar', 'kitchen', 'menu', 'diners', 'catering', 'caterer', 'food truck', 'bakery', 'chef', 'reservations', 'tables'] },
  { id: 'lodging', noun: 'property', plural: 'guests', actors: 'guests', words: ['hotel', 'hostel', 'airbnb', 'villa', 'guesthouse', 'guest house', 'resort', 'rooms', 'check-in', 'check in', 'housekeeping', 'vacation rental', 'short-term rental'] },
  { id: 'retail', noun: 'store', plural: 'customers', actors: 'customers', words: ['store', 'shop', 'retail', 'boutique', 'inventory', 'stock', 'product', 'sku', 'cashier', 'point of sale', 'pos', 'ecommerce', 'e-commerce', 'online store', 'catalog', 'colmado', 'bodega', 'tienda', 'hardware store', 'ferretería', 'ferreteria', 'minimarket', 'supermarket', 'grocery', 'repuestos', 'auto parts', 'car parts', 'spare parts', 'pharmacy'] },
  { id: 'logistics', noun: 'operation', plural: 'customers', actors: 'drivers and dispatchers', words: ['delivery', 'dispatch', 'driver', 'route', 'fleet', 'truck', 'shipment', 'courier', 'logistics', 'warehouse', 'parcel', 'freight'] },
  { id: 'field-service', noun: 'service business', plural: 'customers', actors: 'technicians', words: ['technician', 'repair', 'installation', 'installer', 'plumbing', 'plumber', 'electrician', 'hvac', 'air conditioning', 'maintenance', 'work order', 'service call', 'contractor', 'landscaping', 'cleaning', 'pest control', 'pool'] },
  { id: 'health', noun: 'practice', plural: 'patients', actors: 'patients', words: ['clinic', 'patient', 'doctor', 'dentist', 'dental', 'medical', 'therapy', 'therapist', 'appointment', 'vet', 'veterinary', 'wellness', 'spa', 'salon', 'barber', 'hygienist', 'front desk'] },
  { id: 'education', noun: 'school', plural: 'students', actors: 'students and parents', words: ['school', 'student', 'teacher', 'course', 'classes', 'tutoring', 'tutor', 'academy', 'training center', 'enrollment', 'grade', 'parents', 'curriculum', 'lesson'] },
  { id: 'real-estate', noun: 'rental business', plural: 'tenants', actors: 'tenants and owners', words: ['tenant', 'landlord', 'rent', 'rental', 'lease', 'property management', 'properties', 'apartment', 'units', 'real estate', 'realtor', 'listing', 'hoa', 'condo'] },
  { id: 'nonprofit', noun: 'organization', plural: 'members', actors: 'members and volunteers', words: ['nonprofit', 'non-profit', 'ngo', 'donors', 'donations', 'volunteers', 'volunteer', 'church', 'congregation', 'foundation', 'charity', 'members', 'membership', 'community', 'association', 'cooperative', 'co-op'] },
  { id: 'professional', noun: 'firm', plural: 'clients', actors: 'clients', words: ['law firm', 'lawyer', 'attorney', 'accountant', 'accounting', 'bookkeeping', 'consultant', 'consulting', 'agency', 'architect', 'engineering firm', 'insurance', 'broker', 'notary', 'client', 'proposal', 'retainer', 'billable'] },
  { id: 'construction', noun: 'company', plural: 'clients', actors: 'crews and clients', words: ['construction', 'contractor', 'crew', 'crews', 'site', 'job site', 'jobsite', 'builder', 'renovation', 'blueprints', 'subcontractor', 'materials', 'estimates', 'bids'] },
  { id: 'manufacturing', noun: 'plant', plural: 'customers', actors: 'operators', words: ['factory', 'manufacturing', 'production', 'assembly', 'machines', 'plant', 'workshop', 'fabrication', 'batches', 'quality control'] },
  { id: 'agriculture', noun: 'farm', plural: 'buyers', actors: 'farm workers', words: ['farm', 'farmers', 'crop', 'crops', 'harvest', 'livestock', 'cattle', 'greenhouse', 'agriculture', 'agricultural', 'irrigation', 'produce', 'fishing', 'fishermen', 'cooperative'] },
  { id: 'events', noun: 'events business', plural: 'attendees', actors: 'attendees and organizers', words: ['events', 'event', 'wedding', 'weddings', 'conference', 'festival', 'tickets', 'ticketing', 'venue', 'attendees', 'rsvp', 'planner', 'dj', 'photographer'] },
  { id: 'tourism', noun: 'tour business', plural: 'travelers', actors: 'travelers and guides', words: ['tour', 'excursion', 'travel', 'traveler', 'tourist', 'guide', 'boat', 'charter', 'diving', 'dive shop', 'surf'] },
  { id: 'finance', noun: 'business', plural: 'clients', actors: 'clients', words: ['loans', 'lending', 'microfinance', 'credit', 'remittance', 'fintech', 'bank', 'savings', 'collections', 'installments', 'cooperativa'] },
  { id: 'transport', noun: 'transport business', plural: 'riders', actors: 'riders and drivers', words: ['taxi', 'ride', 'passenger', 'shuttle', 'bus', 'moto', 'motoconcho', 'transport', 'transportation', 'car rental', 'rent a car', 'rental car'] },
  { id: 'public', noun: 'institution', plural: 'citizens', actors: 'citizens and staff', words: ['government', 'municipality', 'ministry', 'public', 'citizens', 'permits', 'licenses', 'city hall', 'ayuntamiento', 'agency'] },
]

export const ACTORS = [
  { id: 'customers', label: 'customers', words: ['customer', 'customers', 'buyers', 'shoppers', 'consumers'] },
  { id: 'clients', label: 'clients', words: ['client', 'clients'] },
  { id: 'staff', label: 'staff', words: ['staff', 'employees', 'employee', 'team', 'workers', 'coworkers', 'colleagues', 'crew', 'operators'] },
  { id: 'technicians', label: 'technicians', words: ['technician', 'technicians', 'installers', 'field team', 'service team'] },
  { id: 'drivers', label: 'drivers', words: ['driver', 'drivers', 'couriers', 'riders'] },
  { id: 'students', label: 'students', words: ['student', 'students', 'learners', 'parents'] },
  { id: 'patients', label: 'patients', words: ['patient', 'patients'] },
  { id: 'tenants', label: 'tenants', words: ['tenant', 'tenants', 'residents', 'owners'] },
  { id: 'members', label: 'members', words: ['member', 'members', 'subscribers'] },
  { id: 'guests', label: 'guests', words: ['guest', 'guests', 'diners', 'visitors', 'travelers', 'tourists'] },
  { id: 'vendors', label: 'vendors', words: ['vendor', 'vendors', 'supplier', 'suppliers', 'partners'] },
  { id: 'volunteers', label: 'volunteers', words: ['volunteer', 'volunteers', 'donors'] },
  { id: 'managers', label: 'the owner or manager', words: ['manager', 'managers', 'owner', 'owners', 'founder', 'director', 'coordinator', 'admin', 'administrator', 'front desk', 'receptionist', 'dispatcher'] },
  { id: 'public', label: 'the public', words: ['users', 'people', 'anyone', 'everyone', 'public', 'community'] },
]

// Negative classes. Imperative task patterns are regular expressions so a
// legitimate project ABOUT essays or recipes is not mistaken for a request to
// write one.
export const OFF_TOPIC_PATTERNS = [
  /\b(write|compose|draft|generate|give|tell|make)\b( me)?( a| an| the| some| my)? ?(poem|essay|story|joke|song|lyrics|recipe|haiku|speech|toast|cover letter|resume|cv|bio|caption|limerick|rap|paragraph|summary|article|blog post)\b/i,
  /\b(translate|summarize|summarise|proofread|rewrite|paraphrase)\b (this|the|my|these|a)\b/i,
  /\bwhat('s| is| was) the (weather|capital|score|time|date|meaning|population|distance|answer)\b/i,
  /\bwho (won|is the (president|prime minister|ceo|owner of))\b/i,
  /\bhow (do i|to|can i) (cook|bake|lose weight|gain weight|fix my car|get a visa|get rich|become famous|tie a|hack|cheat)\b/i,
  /\b(solve|calculate|compute) (this|the|for|my|x)\b/i,
  /\b(medical|legal|tax|financial|investment|relationship|dating) advice\b/i,
  /\bmy (symptoms|doctor|lawyer|therapist|girlfriend|boyfriend|wife|husband|ex) (is|was|says|said|wants|left|cheated|won't|doesn't|keeps|thinks|told)\b/i,
  /\b(love|like|loved) (your|the|this) (site|website|work|design|page)\b|\bgreat (job|work|site)\b|\bnice (site|work|website)\b/i,
  /\brecommend( me)? (a |some )?(movie|movies|book|books|show|shows|series|restaurant|restaurants|song|songs)\b/i,
  /\bhomework\b/i,
  /\b(diagnose|diagnosis|prescription|dosage)\b/i,
  /\b(lottery|betting tips|crypto tip|stock pick|get rich quick)\b/i,
  /\b(hack into|hack my|crack the|bypass (the )?(login|password|paywall)|steal)\b/i,
  /\b(horoscope|zodiac|tarot)\b/i,
  /\b(are you|is this) (a |an )?(bot|ai|robot|human|real person|chatgpt|gpt)\b/i,
  /\bwhat (can|do) you do\b/i,
  /\bwho are you\b/i,
  /\bhow are you\b/i,
  /\btell me about yourself\b/i,
]

export const JOB_SEEKING_PATTERNS = [
  /\b(hire me|looking for (a )?(job|work|position|internship|opportunity)|job opening|vacancy|internship|apply(ing)? for)\b/i,
  /\b(i am|i'm|im) (a|an) (developer|designer|programmer|engineer|freelancer|student looking)\b/i,
  /\b(my (portfolio|resume|cv)|attached (is )?my (resume|cv))\b/i,
  /\bi can build (your|you)\b/i,
]

export const VENDOR_PITCH_PATTERNS = [
  /\b(seo services|backlinks|guest post|increase your (ranking|traffic)|rank(ing)? on google|lead generation services|buy followers|sponsored post|press release distribution|outsource your|offshore (team|developers)|dedicated developers|cheap rates|special offer|limited time offer|white label|reseller program)\b/i,
  /\b(check out our|visit our website|click (here|the link)|unsubscribe|dear (sir|madam|business owner))\b/i,
]

// Weak pitch markers: common in legitimate descriptions ("we offer catering"),
// so they only tip the balance alongside other negatives.
export const VENDOR_PITCH_WEAK_PATTERNS = [
  /\b(our agency|our company offers|our team of (developers|designers|experts)|partnership opportunity|we specialize in|we specialise in)\b/i,
]

export const SUPPORT_PATTERNS = [
  /\b(my account|reset my password|password reset|refund|cancel my (subscription|order|account)|where is my order|login (issue|problem)|can't log ?in|cannot log ?in|invoice from you|your invoice|charged me)\b/i,
]

export const INJECTION_PATTERNS = [
  /\bignore (all |any |the |your |these |those |my )?(previous |prior |above |earlier |preceding )?(instructions|prompts|rules|messages|guidelines)\b/i,
  /\b(print|show|output|repeat|reveal|display) (me )?(your|the) (system )?(prompt|instructions|rules)\b/i,
  /\b(you are now|from now on you are|act as|pretend (to be|you are)|roleplay as)\b/i,
  /\b(system prompt|developer mode|dan mode|jailbreak|reveal your (prompt|instructions)|disregard (your|the|all) (instructions|rules|guidelines))\b/i,
  /\b(repeat (the|your) (instructions|prompt)|what are your instructions)\b/i,
]

export const GREETING_WORDS = [
  'hi', 'hello', 'hey', 'hola', 'yo', 'sup', 'test', 'testing', 'asdf', 'ok',
  'okay', 'thanks', 'thank you', 'good morning', 'good afternoon', 'good evening',
]

// Words that indicate the visitor is describing a solution rather than an objective.
export const SOLUTION_LEADS = [
  /\b(i|we) (want|need|would like)( to (build|create|make|have|develop))? (a|an|some) (new )?(app|application|website|web app|platform|system|tool|software|dashboard|portal|bot|chatbot|crm|database|online store|marketplace)\b/i,
  /^(a|an) (app|website|platform|system|tool|bot|chatbot|dashboard|portal)\b/i,
  /\bbuild (me |us )?(a|an) (app|website|platform|system|tool|bot|chatbot|dashboard|portal|site)\b/i,
]

// Words that indicate the visitor is describing their own operation.
export const OPERATION_PHRASE = /\b(for|at|in|run|runs|running|own|owns|manage|managing|manages|help|helps|helping|grow|growing|improve|improving|have|has) (my|our|a|an|the|two|three|four|five|six|several|\d+) (small |family |local |growing |new |little |busy |two-person |family-run |own )?([a-z][a-z'-]+(?: [a-z][a-z'-]+){0,4})/i

// Words never repeated back in the engine's voice.
export const INTENSIFIERS = /\b(damn|damned|goddamn|stupid|fucking|freaking|frigging|bloody|crappy|shitty|dumb|stinking|whole)\s+/gi

// A person describing themselves by role rather than a business: address them as "you".
export const ROLE_WORDS = /\b(i am|i'm|im|as) (a|an) (landlord|photographer|teacher|tutor|plumber|electrician|dentist|doctor|lawyer|accountant|consultant|freelancer|contractor|designer|architect|coach|trainer|therapist|nurse|realtor|broker|farmer|baker|chef|mechanic|barber|stylist|veterinarian|vet|pharmacist|notary|translator|writer|musician|dj)\b|\bi am a (small|solo|one-person)\b/i

// The visitor is building something for OTHER businesses or the public, not for their own operation.
export const PRODUCT_FOR_OTHERS = /\b(saas|software for|platform for|marketplace|app for (people|users|anyone|everyone|businesses|companies|restaurants|clinics|schools|dentists|doctors|landlords|drivers|farmers|tourists|travelers|students|parents)|(for|to) (dentists|doctors|restaurants|clinics|hotels|schools|landlords|lawyers|gyms|salons|farmers|drivers|businesses|companies|smbs|small businesses|retailers|shops|stores|colmados|nonprofits|municipalities) (to|that|who|so)|like uber|like airbnb|like amazon|uber for|airbnb for|sell (it|this|the app|the software|subscriptions) to)\b/i

// Negation within a few words before a tool name means the visitor rejected it.
export const NEGATION_BEFORE = "(?:\\bnot|\\bno|don't|dont|do not|never|instead of|rather than|without|not another|no more)\\s+(?:a |an |the |another |any |just )?(?:[a-z'-]+\\s+){0,2}?"


// Nouns that make a captured phrase read as "the visitor's operation".
export const ORG_NOUNS = [
  'business', 'company', 'shop', 'store', 'clinic', 'firm', 'agency', 'school',
  'restaurant', 'hotel', 'farm', 'team', 'practice', 'studio', 'office', 'startup',
  'brand', 'nonprofit', 'non-profit', 'church', 'organization', 'organisation',
  'cooperative', 'co-op', 'warehouse', 'bakery', 'salon', 'gym', 'cafe', 'café',
  'bar', 'kitchen', 'boutique', 'pharmacy', 'dealership', 'garage', 'workshop',
  'factory', 'plant', 'lab', 'laboratory', 'academy', 'center', 'centre', 'club',
  'association', 'foundation', 'ministry', 'municipality', 'department', 'hospital',
  'resort', 'villa', 'hostel', 'guesthouse', 'marina', 'fleet', 'operation',
  'operations', 'property', 'properties', 'portfolio', 'market', 'stand', 'truck',
  'venue', 'theater', 'theatre', 'gallery', 'library', 'daycare', 'nursery',
  'university', 'college', 'institute', 'spa', 'barbershop', 'distributor',
  'wholesaler', 'supplier', 'importer', 'exporter', 'courier', 'colmado', 'bodega',
  'tienda', 'empresa', 'negocio', 'consultorio', 'finca', 'office', 'practice',
]

// A captured organization phrase is cut at the first of these words.
export const ORG_CUT_WORDS = new Set([
  'that', 'which', 'where', 'so', 'and', 'but', 'to', 'with', 'because', 'who',
  'when', 'know', 'keep', 'track', 'see', 'get', 'have', 'has', 'can', 'could',
  'would', 'should', 'will', 'is', 'are', 'do', 'does', 'need', 'needs', 'want',
  'wants', 'stop', 'start', 'run', 'runs', 'manage', 'sell', 'sells', 'order',
  'orders', 'book', 'books', 'in', 'at', 'on', 'for', 'of', 'from', 'by', 'about',
  'into', 'over', 'as', 'if', 'or', 'than', 'then', 'while', 'without', 'using',
  'use', 'uses', 'send', 'sends', 'take', 'takes', 'make', 'makes', 'find',
])

export const PURPOSE_CLAUSE = /\b(so that|so we|so i|so they|so our|so customers|so clients|so staff|to help|that lets|that let|that allows|that allow|where|allowing|in order to|to make sure|to stop|to avoid|to reduce|to keep|to see|to know|to track|to let|to give)\b([^.;!?]{6,120})/i

export const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'at',
  'by', 'from', 'up', 'about', 'into', 'over', 'after', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'should', 'could', 'can', 'may', 'might', 'must', 'shall', 'i', 'we', 'you', 'they',
  'he', 'she', 'it', 'my', 'our', 'your', 'their', 'his', 'her', 'its', 'me', 'us',
  'them', 'this', 'that', 'these', 'those', 'there', 'here', 'what', 'which', 'who',
  'whom', 'when', 'where', 'why', 'how', 'all', 'any', 'some', 'no', 'not', 'so',
  'if', 'then', 'than', 'too', 'very', 'just', 'also', 'like', 'want', 'need',
  'get', 'got', 'make', 'made', 'build', 'create', 'thing', 'things', 'something',
  'way', 'lot', 'lots', 'really', 'kind', 'sort', 'know', 'think', 'help', 'able',
  'let', 'new', 'own', 'one', 'two', 'other', 'more', 'most', 'much', 'many',
  'every', 'each', 'because', 'while', 'through', 'currently', 'right', 'now',
  'still', 'always', 'never', 'often', 'sometimes', 'am', 'as', 'out', 'off',
  'im', "i'm", 'ive', "i've", 'dont', "don't", 'cant', "can't", 'wont', "won't",
  'please', 'hi', 'hello', 'ok', 'etc', 'idea', 'app', 'website', 'system',
  'platform', 'tool', 'software', 'application', 'site',
])
