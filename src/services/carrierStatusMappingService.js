const CarrierStatusConfig =
  require('../models/CarrierStatusConfig');


const DEFAULT_CACHE_TTL_MS =
  30 * 1000;


let cachedConfig = null;
let cacheExpiresAt = 0;


/*
 * Charge uniquement la configuration ACTIVE.
 *
 * Un brouillon ou une version archivée ne doit jamais
 * influencer le tracking transporteur.
 */
const loadActiveCarrierStatusConfig =
  async () => {
    const now =
      Date.now();

    if (now < cacheExpiresAt) {
      return cachedConfig;
    }

    const config =
      await CarrierStatusConfig
        .findOne({
          status: 'active'
        })
        .select({
          version: 1,
          mappings: 1
        })
        .lean();

    cachedConfig =
      config || null;

    cacheExpiresAt =
      now + DEFAULT_CACHE_TTL_MS;

    return cachedConfig;
  };


/*
 * Permettra plus tard de vider immédiatement le cache
 * après une activation Admin.
 *
 * Pour le moment cette fonction n'est encore appelée
 * par aucune route.
 */
const clearCarrierStatusConfigCache = () => {
  cachedConfig = null;
  cacheExpiresAt = 0;
};


/*
 * Fonction PURE :
 * cherche une règle Intigo dans une configuration déjà
 * chargée. Aucun accès MongoDB ici.
 */
const findIntigoConfiguredMapping = (
  mappings,
  statusValue
) => {
  const status =
    Number(statusValue);

  if (!Number.isInteger(status)) {
    return null;
  }

  if (!Array.isArray(mappings)) {
    return null;
  }

  const enabledMappings =
    mappings
      .filter(
        mapping =>
          mapping &&
          mapping.enabled !== false
      )
      .sort(
        (a, b) =>
          Number(a.order || 0) -
          Number(b.order || 0)
      );

  for (const mapping of enabledMappings) {
    if (
      mapping.matchType === 'exact' &&
      Number.isInteger(
        Number(mapping.code)
      ) &&
      Number(mapping.code) === status
    ) {
      return mapping;
    }

    if (
      mapping.matchType === 'range'
    ) {
      const rangeStart =
        Number(mapping.rangeStart);

      const rangeEnd =
        Number(mapping.rangeEnd);

      if (
        Number.isInteger(rangeStart) &&
        Number.isInteger(rangeEnd) &&
        status >= rangeStart &&
        status <= rangeEnd
      ) {
        return mapping;
      }
    }
  }

  return null;
};


/*
 * Normalisation identique à celle utilisée pour
 * les statuts Colissimo.
 */
const normalizeCarrierStatus = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();


/*
 * Fonction PURE :
 * cherche une règle Colissimo dans une configuration
 * déjà chargée.
 */
const findColissimoConfiguredMapping = (
  mappings,
  statusValue
) => {
  const status =
    normalizeCarrierStatus(
      statusValue
    );

  if (!status) {
    return null;
  }

  if (!Array.isArray(mappings)) {
    return null;
  }

  return (
    mappings
      .filter(
        mapping =>
          mapping &&
          mapping.enabled !== false
      )
      .sort(
        (a, b) =>
          Number(a.order || 0) -
          Number(b.order || 0)
      )
      .find(
        mapping =>
          normalizeCarrierStatus(
            mapping.providerStatus
          ) === status
      ) ||
    null
  );
};


/*
 * Résolution Intigo.
 *
 * IMPORTANT :
 * fallbackResolver = mapping actuel codé dans
 * intigoStatusService.js.
 *
 * Si aucune V active n'existe OU si MongoDB échoue,
 * le comportement historique est conservé.
 */
const resolveIntigoStatus = async ({
  statusValue,
  fallbackResolver
}) => {
  if (
    typeof fallbackResolver !==
    'function'
  ) {
    throw new TypeError(
      'fallbackResolver must be a function'
    );
  }

  const fallback =
    fallbackResolver(statusValue);

  try {
    const config =
      await loadActiveCarrierStatusConfig();

    if (!config) {
      return {
        ...fallback,
        mappingSource:
          'fallback',
        configVersion:
          null
      };
    }

    const mapping =
      findIntigoConfiguredMapping(
        config.mappings?.intigo,
        statusValue
      );

    if (!mapping) {
      return {
        known:
          false,

        lifecycle:
          'unknown',

        orderStatus:
          null,

        requiresReview:
          true,

        mappingSource:
          'config',

        configVersion:
          config.version
      };
    }

    return {
      known:
        true,

      /*
       * Le lifecycle technique actuel reste utile
       * pour les codes déjà connus.
       *
       * Une future règle Admin inconnue du code reçoit
       * simplement "configured".
       */
      lifecycle:
        fallback?.known
          ? fallback.lifecycle
          : 'configured',

      orderStatus:
        mapping.mappedOrderStatus ??
        null,

      requiresReview:
        false,

      mappingSource:
        'config',

      configVersion:
        config.version
    };
  } catch (error) {
    console.error(
      '[CarrierStatusMapping] Intigo config lookup failed, using fallback:',
      error.message
    );

    return {
      ...fallback,
      mappingSource:
        'fallback_error',
      configVersion:
        null
    };
  }
};


/*
 * Résolution Colissimo.
 *
 * Le résultat est uniquement le statut Order proposé,
 * comme mapColissimoOrderStatus() aujourd'hui.
 */
const resolveColissimoOrderStatus =
  async ({
    statusValue,
    fallbackResolver
  }) => {
    if (
      typeof fallbackResolver !==
      'function'
    ) {
      throw new TypeError(
        'fallbackResolver must be a function'
      );
    }

    try {
      const config =
        await loadActiveCarrierStatusConfig();

      if (!config) {
        return {
          orderStatus:
            fallbackResolver(
              statusValue
            ),

          mappingSource:
            'fallback',

          configVersion:
            null
        };
      }

      const mapping =
        findColissimoConfiguredMapping(
          config.mappings?.colissimo,
          statusValue
        );

      return {
        orderStatus:
          mapping
            ? (
                mapping.mappedOrderStatus ??
                null
              )
            : null,

        mappingSource:
          'config',

        configVersion:
          config.version
      };
    } catch (error) {
      console.error(
        '[CarrierStatusMapping] Colissimo config lookup failed, using fallback:',
        error.message
      );

      return {
        orderStatus:
          fallbackResolver(
            statusValue
          ),

        mappingSource:
          'fallback_error',

        configVersion:
          null
      };
    }
  };


module.exports = {
  loadActiveCarrierStatusConfig,
  clearCarrierStatusConfigCache,
  findIntigoConfiguredMapping,
  findColissimoConfiguredMapping,
  normalizeCarrierStatus,
  resolveIntigoStatus,
  resolveColissimoOrderStatus
};
