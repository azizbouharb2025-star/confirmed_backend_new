const { resolveTunisiaGovernorate } = require('../../utils/tunisiaGovernorateResolver');
const MAX_DESCRIPTION_LENGTH = 500;

const cleanString = value =>
  String(value == null ? '' : value).trim();

const normalizePhone = value => {
  const raw = cleanString(value);

  if (!raw) {
    return '';
  }

  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');

  return hasPlus
    ? `+${digits}`
    : digits;
};

const formatItems = items => {
  if (!Array.isArray(items) || items.length === 0) {
    return 'Colis';
  }

  const description = items
    .map(item => {
      const name = cleanString(item?.name);
      const quantity = Number(item?.quantity) || 1;

      if (!name) {
        return null;
      }

      return `${name} x${quantity}`;
    })
    .filter(Boolean)
    .join(' | ');

  return (
    description ||
    'Colis'
  ).slice(0, MAX_DESCRIPTION_LENGTH);
};

const getSecondaryPhone = order => {
  const deliveryPhone = normalizePhone(
    order?.deliveryInfo?.secondaryPhone
  );

  if (deliveryPhone) {
    return deliveryPhone;
  }

  const additionalPhones =
    order?.clientInfo?.additionalPhones;

  if (Array.isArray(additionalPhones)) {
    const first = additionalPhones
      .map(normalizePhone)
      .find(Boolean);

    if (first) {
      return first;
    }
  }

  return '';
};

const mapOrderToIntigo = order => {
  const address = order?.clientInfo?.address || {};

  const cityName = cleanString(
    resolveTunisiaGovernorate(order) ||
    address.state ||
    order?.region ||
    address.city
  );

  const districtName = cleanString(
    address.district
  );

  const phone1 = normalizePhone(
    order?.clientInfo?.phone
  );

  const phone2 = getSecondaryPhone(order);

  const confirmedReference =
    order?.confirmedId != null
      ? `CONF-${order.confirmedId}`
      : cleanString(order?.orderId);

  const payload = {
    recipient_name: cleanString(
      order?.clientInfo?.name
    ),

    phone1,

    destination_address: cleanString(
      address.street
    ),

    city_name: cityName,

    district_name: districtName,

    price: Number(order?.totalAmount),

    package_size: 1,

    description: formatItems(
      order?.items
    ),

    additional_info: cleanString(
      order?.deliveryInfo?.comment
    ).slice(0, 500),

    can_open: false,

    is_exchange: false,

    cid: confirmedReference.slice(0, 50)
  };

  if (
    phone2 &&
    phone2 !== phone1
  ) {
    payload.phone2 = phone2;
  }

  const email = cleanString(
    order?.clientInfo?.email
  );

  if (email) {
    payload.client_email = email;
  }

  const errors = [];

  if (!payload.recipient_name) {
    errors.push('Nom destinataire manquant');
  }

  const phoneDigits =
    payload.phone1.replace(/\D/g, '');

  if (phoneDigits.length < 8) {
    errors.push('Téléphone principal invalide');
  }

  if (!payload.destination_address) {
    errors.push('Adresse de livraison manquante');
  }

  if (!payload.city_name) {
    errors.push('Gouvernorat / ville Intigo manquant');
  }

  if (
    !Number.isFinite(payload.price) ||
    payload.price < 0
  ) {
    errors.push('Montant COD invalide');
  }

  if (!payload.cid) {
    errors.push('Référence Confirmed manquante');
  }

  return {
    payload,
    errors
  };
};

module.exports = {
  mapOrderToIntigo,
  formatItems,
  normalizePhone
};
