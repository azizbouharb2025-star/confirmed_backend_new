const normalizeColissimoStatus = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();


const validateIntigoMappings = mappings => {
  const errors = [];

  if (!Array.isArray(mappings)) {
    return [
      'Intigo mappings must be an array'
    ];
  }

  const enabledRules = [];

  mappings.forEach((mapping, index) => {
    const prefix =
      `Intigo mapping #${index + 1}`;

    if (
      ![
        'exact',
        'range'
      ].includes(mapping?.matchType)
    ) {
      errors.push(
        `${prefix}: invalid matchType`
      );
      return;
    }

    if (mapping.matchType === 'exact') {
      if (
        !Number.isInteger(mapping.code)
      ) {
        errors.push(
          `${prefix}: exact mapping requires an integer code`
        );
        return;
      }

      if (mapping.enabled !== false) {
        enabledRules.push({
          index,
          start: mapping.code,
          end: mapping.code
        });
      }

      return;
    }

    if (
      !Number.isInteger(mapping.rangeStart) ||
      !Number.isInteger(mapping.rangeEnd)
    ) {
      errors.push(
        `${prefix}: range mapping requires integer rangeStart and rangeEnd`
      );
      return;
    }

    if (
      mapping.rangeStart >
      mapping.rangeEnd
    ) {
      errors.push(
        `${prefix}: rangeStart cannot be greater than rangeEnd`
      );
      return;
    }

    if (mapping.enabled !== false) {
      enabledRules.push({
        index,
        start: mapping.rangeStart,
        end: mapping.rangeEnd
      });
    }
  });

  if (enabledRules.length === 0) {
    errors.push(
      'At least one enabled Intigo mapping is required'
    );
  }

  /*
   * A provider code must match at most one enabled rule.
   * Otherwise the resulting CONFIRMED status would depend
   * on rule ordering and become ambiguous.
   */
  for (
    let leftIndex = 0;
    leftIndex < enabledRules.length;
    leftIndex += 1
  ) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < enabledRules.length;
      rightIndex += 1
    ) {
      const left =
        enabledRules[leftIndex];

      const right =
        enabledRules[rightIndex];

      const overlaps =
        left.start <= right.end &&
        right.start <= left.end;

      if (overlaps) {
        errors.push(
          `Intigo mappings #${left.index + 1} and #${right.index + 1} overlap`
        );
      }
    }
  }

  return errors;
};


const validateColissimoMappings = mappings => {
  const errors = [];

  if (!Array.isArray(mappings)) {
    return [
      'Colissimo mappings must be an array'
    ];
  }

  const seenStatuses =
    new Map();

  let enabledCount = 0;

  mappings.forEach((mapping, index) => {
    const prefix =
      `Colissimo mapping #${index + 1}`;

    const normalized =
      normalizeColissimoStatus(
        mapping?.providerStatus
      );

    if (!normalized) {
      errors.push(
        `${prefix}: providerStatus is required`
      );
      return;
    }

    /*
     * Deux règles actives ne doivent jamais cibler
     * le même statut Colissimo.
     *
     * Une ancienne règle désactivée peut cependant
     * rester dans le brouillon sans créer d'ambiguïté.
     */
    if (mapping.enabled !== false) {
      enabledCount += 1;

      if (seenStatuses.has(normalized)) {
        errors.push(
          `${prefix}: duplicate enabled providerStatus with mapping #${seenStatuses.get(normalized) + 1}`
        );
        return;
      }

      seenStatuses.set(
        normalized,
        index
      );
    }
  });

  if (enabledCount === 0) {
    errors.push(
      'At least one enabled Colissimo mapping is required'
    );
  }

  return errors;
};


const validateForActivation = config => {
  const errors = [];

  if (!config) {
    return {
      valid: false,
      errors: [
        'Carrier status configuration is required'
      ]
    };
  }

  if (
    !Number.isInteger(config.version) ||
    config.version < 1
  ) {
    errors.push(
      'Configuration version must be a positive integer'
    );
  }

  const mappings =
    config.mappings || {};

  errors.push(
    ...validateIntigoMappings(
      mappings.intigo
    )
  );

  errors.push(
    ...validateColissimoMappings(
      mappings.colissimo
    )
  );

  return {
    valid:
      errors.length === 0,

    errors
  };
};


module.exports = {
  validateForActivation,
  validateIntigoMappings,
  validateColissimoMappings
};
