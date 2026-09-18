const { resolveTunisiaGovernorate } = require('../../utils/tunisiaGovernorateResolver');
const COLISSIMO_GOVERNORATES = [
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
  'LE Kef',
  'Mahdia',
  'Mannouba',
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

const cleanString = value =>
  String(value == null ? '' : value).trim();

const normalizeKey = value =>
  cleanString(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const governorateLookup = new Map(
  COLISSIMO_GOVERNORATES.map(value => [
    normalizeKey(value),
    value
  ])
);

/*
 * Variantes communes rencontrées dans les commandes.
 * La valeur envoyée à Colissimo reste toujours exactement
 * celle prévue par leur documentation.
 */
governorateLookup.set(
  normalizeKey('Manouba'),
  'Mannouba'
);

governorateLookup.set(
  normalizeKey('Kef'),
  'LE Kef'
);

governorateLookup.set(
  normalizeKey('Le Kef'),
  'LE Kef'
);

const resolveGovernorate = value => {
  const key = normalizeKey(value);

  if (!key) {
    return null;
  }

  return governorateLookup.get(key) || null;
};

const normalizePhone = value => {
  let digits =
    cleanString(value).replace(/\D/g, '');

  /*
   * +216XXXXXXXX -> XXXXXXXX
   */
  if (
    digits.length === 11 &&
    digits.startsWith('216')
  ) {
    digits = digits.slice(3);
  }

  return digits;
};

const getSecondaryPhone = order => {
  const direct =
    normalizePhone(
      order?.deliveryInfo?.secondaryPhone
    );

  if (direct) {
    return direct;
  }

  const additional =
    order?.clientInfo?.additionalPhones;

  if (Array.isArray(additional)) {
    return (
      additional
        .map(normalizePhone)
        .find(Boolean) || ''
    );
  }

  return '';
};

const getArticleCount = items => {
  if (!Array.isArray(items)) {
    return 0;
  }

  return items.reduce(
    (total, item) => {
      const quantity =
        Number(item?.quantity);

      return total + (
        Number.isFinite(quantity) &&
        quantity > 0
          ? quantity
          : 1
      );
    },
    0
  );
};

const formatDesignation = items => {
  if (!Array.isArray(items)) {
    return '';
  }

  return items
    .map(item => {
      const name =
        cleanString(item?.name);

      const quantity =
        Number(item?.quantity) || 1;

      if (!name) {
        return null;
      }

      return `${name} x${quantity}`;
    })
    .filter(Boolean)
    .join(' | ');
};

const mapOrderToColissimo = (
  order,
  {
    typeColis,
    ouvrir = false,
    fragile = false
  } = {}
) => {
  const address =
    order?.clientInfo?.address || {};

  const detectedGovernorate =
    resolveTunisiaGovernorate(order);

  const rawGovernorate =
    cleanString(
      detectedGovernorate ||
      address.state ||
      order?.region ||
      address.city ||
      address.district
    );

  const governorate =
    resolveGovernorate(
      rawGovernorate
    );

  /*
   * Dans Confirmed :
   * - state / region = gouvernorat
   * - district = localité/délégation lorsqu'elle existe
   * - city reste le fallback
   */
  const city =
    cleanString(
      address.district ||
      address.city
    );

  const phone1 =
    normalizePhone(
      order?.clientInfo?.phone
    );

  const phone2 =
    getSecondaryPhone(order);

  const amount =
    Number(order?.totalAmount);

  const articleCount =
    getArticleCount(
      order?.items
    );

  const packageType =
    Number(typeColis);

  const payload = {
    prix:
      Number.isFinite(amount)
        ? String(amount)
        : '',

    nom:
      cleanString(
        order?.clientInfo?.name
      ),

    gouvernerat:
      governorate ||
      rawGovernorate,

    ville:
      city,

    adresse:
      cleanString(
        address.street
      ),

    tel:
      phone1,

    designation:
      formatDesignation(
        order?.items
      ) || 'Colis',

    nb_article:
      articleCount,

    msg:
      cleanString(
        order?.deliveryInfo?.comment
      ),

    echange:
      'non',

    article:
      '',

    nb_echange:
      0,

    ouvrir:
      ouvrir ? 1 : 0,

    fragile:
      fragile ? 1 : 0,

    type_colis:
      [1, 2, 3].includes(packageType)
        ? packageType
        : null
  };

  const warnings = [];
  const errors = [];

  if (
    phone2 &&
    /^\d{8}$/.test(phone2)
  ) {
    payload.tel2 = phone2;
  } else if (phone2) {
    warnings.push(
      'Téléphone secondaire ignoré : format différent de 8 chiffres'
    );
  }

  if (!payload.nom) {
    errors.push(
      'Nom destinataire manquant'
    );
  }

  if (!rawGovernorate) {
    errors.push(
      'Gouvernorat manquant'
    );
  } else if (!governorate) {
    errors.push(
      `Gouvernorat Colissimo invalide: ${rawGovernorate}`
    );
  }

  if (!payload.ville) {
    errors.push(
      'Ville / délégation manquante'
    );
  }

  if (!payload.adresse) {
    errors.push(
      'Adresse de livraison manquante'
    );
  }

  if (!/^\d{8}$/.test(payload.tel)) {
    errors.push(
      'Téléphone principal Colissimo : exactement 8 chiffres requis'
    );
  }

  if (
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    errors.push(
      'Montant COD invalide'
    );
  }

  if (articleCount < 1) {
    errors.push(
      'Nombre d’articles invalide'
    );
  }

  if (
    ![1, 2, 3].includes(
      packageType
    )
  ) {
    errors.push(
      'typeColis requis : 1=petit, 2=moyen, 3=grand'
    );
  }

  return {
    payload,
    errors,
    warnings
  };
};

module.exports = {
  COLISSIMO_GOVERNORATES,
  resolveGovernorate,
  normalizePhone,
  mapOrderToColissimo
};
