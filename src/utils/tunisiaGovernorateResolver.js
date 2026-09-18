/*
 * Central Tunisian governorate resolver.
 *
 * Internal Confirmed representation always uses the canonical
 * governorate names below.
 *
 * The resolver can inspect state, region, city, district and
 * address text so imports/integrations do not depend on one
 * specific source field.
 */

const TUNISIA_GOVERNORATES = [
  'Ariana',
  'Beja',
  'Ben Arous',
  'Bizerte',
  'Gabes',
  'Gafsa',
  'Jendouba',
  'Kairouan',
  'Kasserine',
  'Kebili',
  'Kef',
  'Mahdia',
  'Manouba',
  'Medenine',
  'Monastir',
  'Nabeul',
  'Sfax',
  'Sidi Bouzid',
  'Siliana',
  'Sousse',
  'Tataouine',
  'Tozeur',
  'Tunis',
  'Zaghouan'
];

const GOVERNORATE_ALIASES = {
  Ariana: [
    'Ariana',
    'Aryanah',
    'أريانة',
    'اريانة'
  ],
  Beja: [
    'Beja',
    'Béja',
    'باجة'
  ],
  'Ben Arous': [
    'Ben Arous',
    'Benarous',
    'بن عروس'
  ],
  Bizerte: [
    'Bizerte',
    'Bizerta',
    'بنزرت'
  ],
  Gabes: [
    'Gabes',
    'Gabès',
    'قابس'
  ],
  Gafsa: [
    'Gafsa',
    'قفصة'
  ],
  Jendouba: [
    'Jendouba',
    'Jenduba',
    'جندوبة'
  ],
  Kairouan: [
    'Kairouan',
    'Kairawan',
    'القيروان',
    'قيروان'
  ],
  Kasserine: [
    'Kasserine',
    'القصرين',
    'قصرين'
  ],
  Kebili: [
    'Kebili',
    'Kébili',
    'قبلي'
  ],
  Kef: [
    'Kef',
    'Le Kef',
    'LE Kef',
    'الكاف'
  ],
  Mahdia: [
    'Mahdia',
    'المهدية',
    'مهدية'
  ],
  Manouba: [
    'Manouba',
    'Mannouba',
    'منوبة'
  ],
  Medenine: [
    'Medenine',
    'Médenine',
    'مدنين'
  ],
  Monastir: [
    'Monastir',
    'المنستير',
    'منستير'
  ],
  Nabeul: [
    'Nabeul',
    'Nabul',
    'نابل'
  ],
  Sfax: [
    'Sfax',
    'صفاقس'
  ],
  'Sidi Bouzid': [
    'Sidi Bouzid',
    'سيدي بوزيد'
  ],
  Siliana: [
    'Siliana',
    'سليانة'
  ],
  Sousse: [
    'Sousse',
    'Soussa',
    'سوسة'
  ],
  Tataouine: [
    'Tataouine',
    'Tatouine',
    'تطاوين'
  ],
  Tozeur: [
    'Tozeur',
    'توزر'
  ],
  Tunis: [
    'Tunis',
    'Tunisia Tunis',
    'تونس'
  ],
  Zaghouan: [
    'Zaghouan',
    'زغوان'
  ]
};

/*
 * Localités/délégations pouvant identifier un gouvernorat
 * même lorsque le nom du gouvernorat n'est pas présent.
 *
 * Cette table est centralisée ici afin que toutes les
 * intégrations bénéficient du même comportement.
 */
const LOCALITY_TO_GOVERNORATE = {
  Tataouine: [
    'Ghomrassen',
    'Ghoumrassen',
    'غمراسن',
    'Guermassa',
    'قرماس'
  ],

  Tunis: [
    'Le Kram',
    'El Kram',
    'Kram',
    'الكرم'
  ],

  'Ben Arous': [
    'Rades',
    'Radès',
    'رادس'
  ]
};

const cleanString = value =>
  String(value == null ? '' : value).trim();

const normalizeLocationText = value =>
  cleanString(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const aliasLookup = new Map();

for (const governorate of TUNISIA_GOVERNORATES) {
  const aliases = GOVERNORATE_ALIASES[governorate] || [];

  for (const alias of [
    governorate,
    ...aliases
  ]) {
    const key = normalizeLocationText(alias);

    if (key) {
      aliasLookup.set(key, governorate);
    }
  }
}

const aliasEntries = Array
  .from(aliasLookup.entries())
  .sort(
    (a, b) =>
      b[0].length - a[0].length
  );

const localityLookup = new Map();

for (const [
  governorate,
  localities
] of Object.entries(
  LOCALITY_TO_GOVERNORATE
)) {
  for (const locality of localities) {
    const key =
      normalizeLocationText(locality);

    if (key) {
      localityLookup.set(
        key,
        governorate
      );
    }
  }
}

const localityEntries = Array
  .from(localityLookup.entries())
  .sort(
    (a, b) =>
      b[0].length - a[0].length
  );

function resolveGovernorateValue(value) {
  const normalized =
    normalizeLocationText(value);

  if (!normalized) {
    return null;
  }

  /*
   * First prefer an exact value.
   */
  const exact =
    aliasLookup.get(normalized);

  if (exact) {
    return exact;
  }

  const exactLocality =
    localityLookup.get(normalized);

  if (exactLocality) {
    return exactLocality;
  }

  /*
   * Search only complete words/tokens.
   * This prevents e.g. "Tunis" matching "Tunisianet".
   */
  const padded =
    ` ${normalized} `;

  for (const [
    alias,
    governorate
  ] of aliasEntries) {
    if (
      padded.includes(
        ` ${alias} `
      )
    ) {
      return governorate;
    }
  }

  for (const [
    locality,
    governorate
  ] of localityEntries) {
    if (
      padded.includes(
        ` ${locality} `
      )
    ) {
      return governorate;
    }
  }

  return null;
}

function extractOrderCandidates(order) {
  const address =
    order?.clientInfo?.address || {};

  return [
    address.state,
    order?.region,
    address.city,
    address.district,
    address.street,

    order?.deliveryInfo?.governorate,
    order?.deliveryInfo?.gouvernorat,
    order?.deliveryInfo?.region,
    order?.deliveryInfo?.state,
    order?.deliveryInfo?.city,
    order?.deliveryInfo?.district,
    order?.deliveryInfo?.address
  ];
}

function resolveTunisiaGovernorate(input) {
  let candidates;

  if (Array.isArray(input)) {
    candidates = input;
  } else if (
    typeof input === 'string' ||
    typeof input === 'number'
  ) {
    candidates = [input];
  } else {
    candidates =
      extractOrderCandidates(input);
  }

  for (const candidate of candidates) {
    const governorate =
      resolveGovernorateValue(
        candidate
      );

    if (governorate) {
      return governorate;
    }
  }

  return null;
}

function applyTunisiaGovernorate(order) {
  if (!order) {
    return null;
  }

  const governorate =
    resolveTunisiaGovernorate(order);

  if (!governorate) {
    return null;
  }

  if (!order.clientInfo) {
    order.clientInfo = {};
  }

  if (!order.clientInfo.address) {
    order.clientInfo.address = {};
  }

  order.clientInfo.address.state =
    governorate;

  order.region =
    governorate;

  return governorate;
}

module.exports = {
  TUNISIA_GOVERNORATES,
  GOVERNORATE_ALIASES,
  LOCALITY_TO_GOVERNORATE,
  normalizeLocationText,
  resolveGovernorateValue,
  resolveTunisiaGovernorate,
  applyTunisiaGovernorate
};
