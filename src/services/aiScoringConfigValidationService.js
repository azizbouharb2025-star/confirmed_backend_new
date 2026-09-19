class AIScoringConfigValidationService {
  /**
   * Return only enabled rules.
   */
  getEnabledRules(rules) {
    return Array.isArray(rules)
      ? rules.filter(rule => rule && rule.enabled !== false)
      : [];
  }

  /**
   * Validate numeric ranges.
   *
   * Supports:
   * - open minimum: min = null
   * - open maximum: max = null
   * - inclusive/exclusive bounds
   * - overlap detection
   * - optional full coverage detection
   */
  validateRangeRules(
    rules,
    {
      label = 'ranges',
      requireFullCoverage = false,
      domainMin = null,
      domainMax = null
    } = {}
  ) {
    const errors = [];
    const activeRules = this.getEnabledRules(rules);

    if (activeRules.length === 0) {
      if (requireFullCoverage) {
        errors.push(
          `${label}: at least one active range is required`
        );
      }

      return errors;
    }

    const normalized = activeRules.map((rule, index) => {
      const min =
        rule.min === null || rule.min === undefined
          ? null
          : Number(rule.min);

      const max =
        rule.max === null || rule.max === undefined
          ? null
          : Number(rule.max);

      const includeMin =
        rule.includeMin !== false;

      const includeMax =
        rule.includeMax !== false;

      const ruleLabel =
        rule.label ||
        rule.key ||
        `rule_${index + 1}`;

      if (
        min !== null &&
        !Number.isFinite(min)
      ) {
        errors.push(
          `${label}: invalid minimum for "${ruleLabel}"`
        );
      }

      if (
        max !== null &&
        !Number.isFinite(max)
      ) {
        errors.push(
          `${label}: invalid maximum for "${ruleLabel}"`
        );
      }

      if (
        min !== null &&
        max !== null &&
        min > max
      ) {
        errors.push(
          `${label}: minimum is greater than maximum for "${ruleLabel}"`
        );
      }

      if (
        min !== null &&
        max !== null &&
        min === max &&
        (!includeMin || !includeMax)
      ) {
        errors.push(
          `${label}: empty interval for "${ruleLabel}"`
        );
      }

      return {
        rule,
        ruleLabel,
        min,
        max,
        includeMin,
        includeMax
      };
    });

    if (errors.length > 0) {
      return errors;
    }

    normalized.sort((a, b) => {
      const aMin =
        a.min === null
          ? Number.NEGATIVE_INFINITY
          : a.min;

      const bMin =
        b.min === null
          ? Number.NEGATIVE_INFINITY
          : b.min;

      if (aMin !== bMin) {
        return aMin - bMin;
      }

      const aMax =
        a.max === null
          ? Number.POSITIVE_INFINITY
          : a.max;

      const bMax =
        b.max === null
          ? Number.POSITIVE_INFINITY
          : b.max;

      return aMax - bMax;
    });

    for (
      let index = 1;
      index < normalized.length;
      index += 1
    ) {
      const previous =
        normalized[index - 1];

      const current =
        normalized[index];

      const previousMax =
        previous.max === null
          ? Number.POSITIVE_INFINITY
          : previous.max;

      const currentMin =
        current.min === null
          ? Number.NEGATIVE_INFINITY
          : current.min;

      const numericOverlap =
        previousMax > currentMin;

      const boundaryOverlap =
        previousMax === currentMin &&
        previous.includeMax &&
        current.includeMin;

      if (
        numericOverlap ||
        boundaryOverlap
      ) {
        errors.push(
          `${label}: overlap between "${previous.ruleLabel}" and "${current.ruleLabel}"`
        );

        continue;
      }

      if (requireFullCoverage) {
        const numericGap =
          previousMax < currentMin;

        const boundaryGap =
          previousMax === currentMin &&
          !previous.includeMax &&
          !current.includeMin;

        if (
          numericGap ||
          boundaryGap
        ) {
          errors.push(
            `${label}: gap between "${previous.ruleLabel}" and "${current.ruleLabel}"`
          );
        }
      }
    }

    if (requireFullCoverage) {
      const first = normalized[0];
      const last =
        normalized[normalized.length - 1];

      if (domainMin === null) {
        if (first.min !== null) {
          errors.push(
            `${label}: first active interval must have no minimum`
          );
        }
      } else {
        if (
          first.min === null ||
          first.min > domainMin ||
          (
            first.min === domainMin &&
            !first.includeMin
          )
        ) {
          errors.push(
            `${label}: active intervals do not cover the minimum value ${domainMin}`
          );
        }

        if (
          first.min !== null &&
          first.min < domainMin
        ) {
          errors.push(
            `${label}: interval "${first.ruleLabel}" starts below allowed minimum ${domainMin}`
          );
        }
      }

      if (domainMax === null) {
        if (last.max !== null) {
          errors.push(
            `${label}: last active interval must have no maximum`
          );
        }
      } else {
        if (
          last.max === null ||
          last.max < domainMax ||
          (
            last.max === domainMax &&
            !last.includeMax
          )
        ) {
          errors.push(
            `${label}: active intervals do not cover the maximum value ${domainMax}`
          );
        }

        if (
          last.max !== null &&
          last.max > domainMax
        ) {
          errors.push(
            `${label}: interval "${last.ruleLabel}" ends above allowed maximum ${domainMax}`
          );
        }
      }
    }

    return errors;
  }

  /**
   * Validate geographic rules.
   *
   * An active geographic value must exist only once
   * for the same location type.
   */
  validateGeographicRules(rules) {
    const errors = [];

    if (!Array.isArray(rules)) {
      return [
        'geographicZone.rules must be an array'
      ];
    }

    const seen = new Set();

    for (const rule of rules) {
      if (
        !rule ||
        rule.enabled === false
      ) {
        continue;
      }

      const locationType =
        String(
          rule.locationType || ''
        ).trim();

      const locationValue =
        String(
          rule.locationValue || ''
        )
          .trim()
          .toLowerCase();

      if (!locationType) {
        errors.push(
          'geographicZone: active rule requires locationType'
        );

        continue;
      }

      if (!locationValue) {
        errors.push(
          'geographicZone: active rule requires locationValue'
        );

        continue;
      }

      const key =
        `${locationType}:${locationValue}`;

      if (seen.has(key)) {
        errors.push(
          `geographicZone: duplicate active location "${locationType}:${rule.locationValue}"`
        );
      }

      seen.add(key);

      if (
        !Number.isFinite(
          Number(rule.impact)
        )
      ) {
        errors.push(
          `geographicZone: invalid impact for "${rule.locationValue}"`
        );
      }
    }

    return errors;
  }

  /**
   * Validate configured order-time ranges.
   *
   * Time ranges are represented without crossing midnight.
   * Example:
   * 22:00 → 00:00 is stored as 1320 → 1440.
   * 00:00 → 02:00 is stored as 0 → 120.
   */
  validateTimeRules(rules) {
    const errors = [];

    const activeRules =
      this.getEnabledRules(rules);

    if (activeRules.length === 0) {
      return [
        'orderTime: at least one active time range is required'
      ];
    }

    const normalized =
      activeRules.map((rule, index) => {
        const label =
          rule.label ||
          rule.key ||
          `time_rule_${index + 1}`;

        const start =
          Number(rule.startMinute);

        const end =
          Number(rule.endMinute);

        if (
          !Number.isInteger(start) ||
          start < 0 ||
          start > 1439
        ) {
          errors.push(
            `orderTime: invalid startMinute for "${label}"`
          );
        }

        if (
          !Number.isInteger(end) ||
          end < 1 ||
          end > 1440
        ) {
          errors.push(
            `orderTime: invalid endMinute for "${label}"`
          );
        }

        if (
          Number.isInteger(start) &&
          Number.isInteger(end) &&
          start >= end
        ) {
          errors.push(
            `orderTime: startMinute must be lower than endMinute for "${label}"`
          );
        }

        return {
          label,
          start,
          end
        };
      });

    if (errors.length > 0) {
      return errors;
    }

    normalized.sort(
      (a, b) => a.start - b.start
    );

    if (normalized[0].start !== 0) {
      errors.push(
        'orderTime: active ranges must start at 00:00'
      );
    }

    for (
      let index = 1;
      index < normalized.length;
      index += 1
    ) {
      const previous =
        normalized[index - 1];

      const current =
        normalized[index];

      if (
        previous.end >
        current.start
      ) {
        errors.push(
          `orderTime: overlap between "${previous.label}" and "${current.label}"`
        );
      } else if (
        previous.end <
        current.start
      ) {
        errors.push(
          `orderTime: gap between "${previous.label}" and "${current.label}"`
        );
      }
    }

    const last =
      normalized[normalized.length - 1];

    if (last.end !== 1440) {
      errors.push(
        'orderTime: active ranges must end at 24:00'
      );
    }

    return errors;
  }

  /**
   * Validate operator feedback categories and
   * question/category references.
   */
  validateFeedbackCategories(
    categories,
    questions = []
  ) {
    const errors = [];

    if (!Array.isArray(categories)) {
      return [
        'operatorFeedback.categories must be an array'
      ];
    }

    const categoryKeys = new Set();

    for (const category of categories) {
      if (!category) {
        continue;
      }

      const key =
        String(
          category.key || ''
        ).trim();

      if (!key) {
        errors.push(
          'operatorFeedback: every category must have a key'
        );

        continue;
      }

      if (categoryKeys.has(key)) {
        errors.push(
          `operatorFeedback: duplicate category key "${key}"`
        );
      }

      categoryKeys.add(key);

      if (
        !String(
          category.label || ''
        ).trim()
      ) {
        errors.push(
          `operatorFeedback: category "${key}" requires a label`
        );
      }
    }

    if (Array.isArray(questions)) {
      for (const question of questions) {
        if (!question) {
          continue;
        }

        const questionKey =
          String(
            question.key || ''
          ).trim();

        const categoryKey =
          String(
            question.categoryKey ||
            'general'
          ).trim();

        if (
          categoryKey &&
          !categoryKeys.has(
            categoryKey
          )
        ) {
          errors.push(
            `operatorFeedback: question "${questionKey}" references unknown category "${categoryKey}"`
          );
        }
      }
    }

    return errors;
  }

  /**
   * Validate operator feedback questions.
   */
  validateFeedbackQuestions(questions) {
    const errors = [];

    if (!Array.isArray(questions)) {
      return [
        'operatorFeedback.questions must be an array'
      ];
    }

    const questionKeys = new Set();

    for (const question of questions) {
      if (!question) {
        continue;
      }

      const key =
        String(question.key || '').trim();

      if (!key) {
        errors.push(
          'operatorFeedback: every question must have a key'
        );

        continue;
      }

      if (questionKeys.has(key)) {
        errors.push(
          `operatorFeedback: duplicate question key "${key}"`
        );
      }

      questionKeys.add(key);

      if (
        ![
          'single_choice',
          'multiple_choice'
        ].includes(question.type)
      ) {
        errors.push(
          `operatorFeedback: unsupported type for "${key}"`
        );
      }

      const answers =
        Array.isArray(question.answers)
          ? question.answers
          : [];

      const activeAnswers =
        answers.filter(
          answer =>
            answer &&
            answer.active !== false
        );

      if (
        question.active !== false &&
        activeAnswers.length === 0
      ) {
        errors.push(
          `operatorFeedback: active question "${key}" requires at least one active answer`
        );
      }

      if (
        question.type ===
        'multiple_choice'
      ) {
        const maxSelections =
          Number(question.maxSelections);

        if (
          !Number.isInteger(
            maxSelections
          ) ||
          maxSelections < 1
        ) {
          errors.push(
            `operatorFeedback: "${key}" requires a positive maxSelections`
          );
        } else if (
          activeAnswers.length > 0 &&
          maxSelections >
          activeAnswers.length
        ) {
          errors.push(
            `operatorFeedback: maxSelections for "${key}" cannot exceed active answers`
          );
        }
      }

      const answerKeys = new Set();

      for (const answer of answers) {
        const answerKey =
          String(answer?.key || '').trim();

        if (!answerKey) {
          errors.push(
            `operatorFeedback: every answer in "${key}" must have a key`
          );

          continue;
        }

        if (answerKeys.has(answerKey)) {
          errors.push(
            `operatorFeedback: duplicate answer key "${answerKey}" in "${key}"`
          );
        }

        answerKeys.add(answerKey);

        if (
          !Number.isFinite(
            Number(answer.impact)
          )
        ) {
          errors.push(
            `operatorFeedback: invalid impact for "${key}.${answerKey}"`
          );
        }
      }
    }

    return errors;
  }

  /**
   * Full validation performed before activation.
   *
   * Draft configurations may temporarily be incomplete.
   * Activation must be strict.
   */
  validateForActivation(config) {
    const errors = [];

    if (!config) {
      return {
        valid: false,
        errors: [
          'AI scoring configuration is required'
        ]
      };
    }

    const general =
      config.general || {};

    const baseScore =
      Number(general.baseScore);

    const minimumScore =
      Number(general.minimumScore);

    const maximumScore =
      Number(general.maximumScore);

    if (
      !Number.isFinite(baseScore) ||
      !Number.isFinite(minimumScore) ||
      !Number.isFinite(maximumScore)
    ) {
      errors.push(
        'general: baseScore, minimumScore and maximumScore must be valid numbers'
      );
    } else {
      if (
        minimumScore >
        maximumScore
      ) {
        errors.push(
          'general: minimumScore cannot exceed maximumScore'
        );
      }

      if (
        baseScore < minimumScore ||
        baseScore > maximumScore
      ) {
        errors.push(
          'general: baseScore must be between minimumScore and maximumScore'
        );
      }
    }

    if (
      config.patterns?.enabled !== false
    ) {
      if (
        config.patterns?.geographicZone
          ?.enabled !== false
      ) {
        errors.push(
          ...this.validateGeographicRules(
            config.patterns
              .geographicZone.rules
          )
        );
      }

      if (
        config.patterns?.orderValue
          ?.enabled !== false
      ) {
        if (
          config.patterns?.orderValue
            ?.relativeToHistory
            ?.enabled !== false
        ) {
          errors.push(
            ...this.validateRangeRules(
              config.patterns.orderValue
                .relativeToHistory.rules,
              {
                label:
                  'orderValue.relativeToHistory',
                requireFullCoverage: true,
                domainMin: 0,
                domainMax: null
              }
            )
          );
        }

        if (
          config.patterns?.orderValue
            ?.absoluteValue
            ?.enabled !== false
        ) {
          errors.push(
            ...this.validateRangeRules(
              config.patterns.orderValue
                .absoluteValue.rules,
              {
                label:
                  'orderValue.absoluteValue',
                requireFullCoverage: true,
                domainMin: 0,
                domainMax: null
              }
            )
          );
        }
      }

      if (
        config.patterns?.orderTime
          ?.enabled !== false
      ) {
        errors.push(
          ...this.validateTimeRules(
            config.patterns.orderTime.rules
          )
        );
      }
    }

    if (
      config.customerHistory?.enabled !== false
    ) {
      if (
        config.customerHistory
          ?.successfulDeliveries
          ?.enabled !== false
      ) {
        errors.push(
          ...this.validateRangeRules(
            config.customerHistory
              .successfulDeliveries.rules,
            {
              label:
                'customerHistory.successfulDeliveries',
              requireFullCoverage: true,
              domainMin: 0,
              domainMax: null
            }
          )
        );
      }

      if (
        config.customerHistory
          ?.failedDeliveries
          ?.enabled !== false
      ) {
        errors.push(
          ...this.validateRangeRules(
            config.customerHistory
              .failedDeliveries.rules,
            {
              label:
                'customerHistory.failedDeliveries',
              requireFullCoverage: true,
              domainMin: 0,
              domainMax: null
            }
          )
        );
      }
    }

    if (
      config.operatorFeedback?.enabled !== false
    ) {
      errors.push(
        ...this.validateFeedbackCategories(
          config.operatorFeedback.categories,
          config.operatorFeedback.questions
        )
      );

      errors.push(
        ...this.validateFeedbackQuestions(
          config.operatorFeedback.questions
        )
      );
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports =
  new AIScoringConfigValidationService();
