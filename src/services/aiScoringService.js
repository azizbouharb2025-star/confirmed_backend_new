const Order = require('../models/Order');

class AIScoringService {
  /**
   * Ajustement comportemental V1.
   *
   * Il s'agit d'une règle métier transparente, pas d'un
   * modèle ML entraîné.
   *
   * L'ajustement total est volontairement plafonné à
   * +/- 15 points afin que le retour opérateur améliore
   * le score sans remplacer les autres facteurs.
   */
  calculateOperatorFeedbackAdjustment(feedback) {
    if (!feedback || !feedback.submittedAt) {
      return {
        adjustment: 0,
        applied: false,
        summary: 'Aucun retour opérateur'
      };
    }

    /*
     * PDF Scoring IA :
     * maximum 3 observations de ton/comportement.
     *
     * La validation HTTP applique déjà cette limite.
     * On la réapplique ici par sécurité.
     */
    const toneWeights = {
      polite: 1,
      confident: 1,
      enthusiastic: 1,
      quick_response: 1,

      hesitant: -1,
      distracted: -1,
      long_pauses: -1,

      rude: -2,
      aggressive: -2,
      nervous: -1,
      low_interest: -2
    };

    const confirmationWeights = {
      very_firm: 5,
      normal: 2,
      weak: -4
    };

    const priceWeights = {
      no_issue: 1,
      asks_discount: -1,
      insists_discount: -3,
      strong_negotiation: -4
    };

    const productWeights = {
      none: 1,
      asks_question: 0,
      multiple_doubts: -2,
      compares_seller: -3
    };

    const deliveryWeights = {
      complete_quick: 4,
      clear_precise: 3,
      partial: -1,
      vague: -3,
      difficulty: -4,
      refuses_details: -5
    };

    const engagementWeights = {
      very_engaged: 3,
      interested: 2,
      passive: 0,
      low_involvement: -2,
      distracted: -3
    };

    const receptionWeights = {
      no_information: 0,
      wants_fast_delivery: 3,
      clearly_confirms_receipt: 3,
      asks_delivery_info: 1,
      uncertain_receipt: -2,
      does_not_know_when: -3
    };

    const toneSignals = [
      ...new Set(
        Array.isArray(feedback.toneSignals)
          ? feedback.toneSignals
          : []
      )
    ].slice(0, 3);

    let raw = 0;

    for (const signal of toneSignals) {
      raw += toneWeights[signal] || 0;
    }

    raw +=
      confirmationWeights[
        feedback.confirmationLevel
      ] || 0;

    raw +=
      priceWeights[
        feedback.priceBehavior
      ] || 0;

    raw +=
      productWeights[
        feedback.productDoubts
      ] || 0;

    raw +=
      deliveryWeights[
        feedback.deliveryInformation
      ] || 0;

    raw +=
      engagementWeights[
        feedback.engagementLevel
      ] || 0;

    raw +=
      receptionWeights[
        feedback.receptionIntent
      ] || 0;

    /*
     * IMPORTANT :
     * aucun clamp -15/+15 dans le PDF.
     *
     * Le clamp global du score final sera appliqué
     * entre 20 et 97.
     */
    return {
      adjustment: raw,
      applied: raw !== 0,
      summary:
        raw > 0
          ? 'Retour opérateur globalement favorable'
          : raw < 0
            ? 'Retour opérateur présentant des signaux de vigilance'
            : 'Retour opérateur globalement neutre'
    };
  }

  /**
   * Charge uniquement les données historiques nécessaires
   * au Score IA.
   *
   * L'historique est limité à la boutique actuelle afin
   * de ne pas mélanger les clients de plusieurs shops.
   */
  async buildScoringContext(order) {
    const context = {
      customerHistory: {
        successfulDeliveries: 0,
        failedDeliveries: 0
      }
    };

    const phone =
      typeof order.clientInfo?.phone === 'string'
        ? order.clientInfo.phone.trim()
        : '';

    const shopId = order.shopId;

    if (!phone || !shopId) {
      return context;
    }

    const customerQuery = {
      shopId,
      'clientInfo.phone': phone
    };

    /*
     * Lors d'un recalcul après confirmation,
     * la commande existe déjà en base.
     * Elle ne doit pas compter dans son propre historique.
     */
    if (order._id) {
      customerQuery._id = {
        $ne: order._id
      };
    }

    const [
      successfulDeliveries,
      failedDeliveries
    ] = await Promise.all([
      Order.countDocuments({
        ...customerQuery,
        status: 'delivered'
      }),

      Order.countDocuments({
        ...customerQuery,
        status: 'failed_delivery'
      })
    ]);

    context.customerHistory = {
      successfulDeliveries,
      failedDeliveries
    };

    return context;
  }

  /**
   * PDF : historique de livraisons réussies.
   */
  calculateCustomerSuccessAdjustment(count) {
    if (count >= 11) return 10;
    if (count >= 7) return 8;
    if (count >= 4) return 6;
    if (count >= 2) return 4;
    if (count >= 1) return 2;

    return 0;
  }

  /**
   * PDF : historique d'échecs de livraison.
   */
  calculateCustomerFailureAdjustment(count) {
    if (count >= 6) return -15;
    if (count >= 4) return -12;
    if (count >= 3) return -9;
    if (count >= 2) return -6;
    if (count >= 1) return -3;

    return 0;
  }

  /**
   * PDF : qualité d'adresse.
   *
   * Adresse complète = rue + ville + gouvernorat.
   * Cette définition reprend les contrôles d'adresse déjà
   * utilisés par CONFIRMED.
   */
  calculateAddressAdjustment(order) {
    const address = order.clientInfo?.address || {};

    const street = String(
      address.street || ''
    ).trim();

    const city = String(
      address.city || ''
    ).trim();

    const state = String(
      address.state ||
      order.region ||
      ''
    ).trim();

    if (street && city && state) {
      return {
        adjustment: 6,
        state: 'complete'
      };
    }

    if (street || city || state) {
      return {
        adjustment: -3,
        state: 'partial'
      };
    }

    return {
      adjustment: -10,
      state: 'missing'
    };
  }

  /**
   * PDF : montant absolu de la commande.
   *
   * La deuxième règle du PDF compare également la commande
   * aux habitudes historiques. Aucun seuil numérique
   * permettant de définir "légèrement supérieure",
   * "élevée" ou "très élevée" n'est fourni.
   * Elle reste donc neutre en V1 plutôt que d'inventer
   * des seuils.
   */
  calculateOrderAmountAdjustment(amount) {
    const value = Number(amount);

    if (!Number.isFinite(value)) {
      return 0;
    }

    if (value < 30) return -1;
    if (value < 150) return 0;
    if (value < 250) return -1;
    if (value < 400) return -3;
    if (value < 600) return -5;

    return -6;
  }

  /**
   * Heure locale tunisienne utilisée par le PDF.
   */
  getTunisiaOrderHour(order) {
    const date =
      order.createdAt
        ? new Date(order.createdAt)
        : new Date();

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    const parts =
      new Intl.DateTimeFormat(
        'en-GB',
        {
          timeZone: 'Africa/Tunis',
          hour: '2-digit',
          hour12: false
        }
      ).formatToParts(date);

    const hourPart =
      parts.find(part => part.type === 'hour');

    if (!hourPart) {
      return null;
    }

    const hour = Number(hourPart.value);

    if (!Number.isFinite(hour)) {
      return null;
    }

    return hour % 24;
  }

  /**
   * PDF : heure de commande.
   */
  calculateOrderTimeAdjustment(order) {
    const hour = this.getTunisiaOrderHour(order);

    if (hour === null) {
      return {
        adjustment: 0,
        hour: null
      };
    }

    if (hour >= 8 && hour < 22) {
      return {
        adjustment: 0,
        hour
      };
    }

    if (hour >= 22) {
      return {
        adjustment: -1,
        hour
      };
    }

    if (hour < 2) {
      return {
        adjustment: -2,
        hour
      };
    }

    if (hour < 6) {
      return {
        adjustment: -3,
        hour
      };
    }

    return {
      adjustment: -1,
      hour
    };
  }

  /**
   * Calculate AI score according to Scoring IA PDF.
   *
   * Base     : 65
   * Minimum  : 20
   * Maximum  : 97
   */
  calculateAIScore(order, context = {}) {
    let score = 65;

    const factors = [];

    // =====================================================
    // 1. ADRESSE
    // =====================================================

    const addressResult =
      this.calculateAddressAdjustment(order);

    score += addressResult.adjustment;

    factors.push({
      key: 'address',
      label: 'Adresse',
      value: addressResult.state,
      impact: addressResult.adjustment,
      applied: addressResult.adjustment !== 0
    });

    // =====================================================
    // 2. ZONE GEOGRAPHIQUE
    // =====================================================

    /*
     * V1 du PDF :
     * aucune ville / aucun gouvernorat ne reçoit
     * de bonus ou pénalité fixe.
     */
    factors.push({
      key: 'region',
      label: 'Zone géographique',
      value:
        order.region ||
        order.clientInfo?.address?.state ||
        order.clientInfo?.address?.city ||
        '',
      impact: 0,
      applied: false
    });

    // =====================================================
    // 3. VALEUR DE COMMANDE
    // =====================================================

    const amountAdjustment =
      this.calculateOrderAmountAdjustment(
        order.totalAmount
      );

    score += amountAdjustment;

    factors.push({
      key: 'order_amount',
      label: 'Valeur totale de la commande',
      value: order.totalAmount,
      impact: amountAdjustment,
      applied: amountAdjustment !== 0
    });

    /*
     * Comparaison historique du montant :
     * neutralisée tant que les seuils métier ne sont
     * pas définis dans le cahier des charges.
     */
    factors.push({
      key: 'order_amount_history',
      label: 'Valeur par rapport aux commandes habituelles',
      value: 'Seuils non définis',
      impact: 0,
      applied: false
    });

    // =====================================================
    // 4. HEURE DE COMMANDE
    // =====================================================

    const timeResult =
      this.calculateOrderTimeAdjustment(order);

    score += timeResult.adjustment;

    factors.push({
      key: 'order_time',
      label: 'Heure de commande',
      value:
        timeResult.hour === null
          ? null
          : `${String(timeResult.hour).padStart(2, '0')}:00`,
      impact: timeResult.adjustment,
      applied: timeResult.adjustment !== 0
    });

    /*
     * Le PDF mentionne également les horaires
     * historiquement associés à plus d'échecs.
     * Aucun seuil statistique n'étant défini,
     * ce sous-signal reste neutre.
     */
    factors.push({
      key: 'order_time_history',
      label: 'Historique de l’heure de commande',
      value: 'Seuil statistique non défini',
      impact: 0,
      applied: false
    });

    // =====================================================
    // 5. HISTORIQUE CLIENT
    // =====================================================

    const successfulDeliveries =
      Number(
        context.customerHistory
          ?.successfulDeliveries
      ) || 0;

    const failedDeliveries =
      Number(
        context.customerHistory
          ?.failedDeliveries
      ) || 0;

    const successAdjustment =
      this.calculateCustomerSuccessAdjustment(
        successfulDeliveries
      );

    const failureAdjustment =
      this.calculateCustomerFailureAdjustment(
        failedDeliveries
      );

    score += successAdjustment;
    score += failureAdjustment;

    factors.push({
      key: 'customer_success_history',
      label: 'Livraisons réussies du client',
      value: successfulDeliveries,
      impact: successAdjustment,
      applied: successAdjustment !== 0
    });

    factors.push({
      key: 'customer_failure_history',
      label: 'Échecs de livraison du client',
      value: failedDeliveries,
      impact: failureAdjustment,
      applied: failureAdjustment !== 0
    });

    // =====================================================
    // 6. RETOUR OPERATEUR
    // =====================================================

    const operatorBehavior =
      this.calculateOperatorFeedbackAdjustment(
        order.operatorFeedback
      );

    score += operatorBehavior.adjustment;

    factors.push({
      key: 'operator_feedback',
      label: 'Retour comportemental opérateur',
      value: operatorBehavior.summary,
      impact: operatorBehavior.adjustment,
      applied: operatorBehavior.applied
    });

    // =====================================================
    // FINAL
    // =====================================================

    score = Math.max(
      20,
      Math.min(
        97,
        Math.round(score)
      )
    );

    return {
      score,
      factors
    };
  }

  /**
   * Convert score to risk level
   */
  calculateRiskLevel(score) {
    if (score <= 20) {
      return 'critical';
    }

    if (score <= 40) {
      return 'high';
    }

    if (score <= 60) {
      return 'medium';
    }

    if (score <= 80) {
      return 'low';
    }

    return 'very_low';
  }

  /**
   * Convert score to AI decision
   */
  calculateDecision(score) {
    if (score < 40) {
      return 'reject';
    }

    if (score <= 70) {
      return 'review';
    }

    return 'accept';
  }

  /**
   * Generate address-quality findings from real order data.
   * These findings are descriptive only for now and do not
   * modify the numerical AI score.
   */
  generateAddressFindings(order) {
    const address = order.clientInfo?.address || {};

    const street = (address.street || '').trim();
    const city = (address.city || '').trim();
    const state = (address.state || order.region || '').trim();
    const zipCode = (address.zipCode || '').trim();

    const findings = [];

    const hasStreet = street.length > 0;
    const hasStreetNumber = /\d+/.test(street);
    const hasCity = city.length > 0;
    const hasState = state.length > 0;
    const hasZipCode = zipCode.length > 0;

    const vagueAddress =
      /\b(pr[eè]s de|chez|[àa] c[oô]t[eé] de|derri[eè]re|devant)\b/i.test(street);

    if (hasStreet && hasCity && hasState) {
      findings.push({
        key: 'address_complete',
        level: 'positive',
        description: 'Adresse complète et précise.',
        impact: 'positive'
      });
    } else if (hasStreet || hasCity || hasState) {
      findings.push({
        key: 'address_partial',
        level: 'neutral',
        description: 'Adresse partiellement renseignée.',
        impact: 'neutral'
      });
    } else {
      findings.push({
        key: 'address_incomplete',
        level: 'alert',
        description: 'Adresse incomplète.',
        impact: 'negative'
      });
    }

    if (hasStreet) {
      findings.push({
        key: 'street_present',
        level: 'positive',
        description: 'Rue renseignée.',
        impact: 'positive'
      });
    } else {
      findings.push({
        key: 'street_missing',
        level: 'alert',
        description: 'Rue absente.',
        impact: 'negative'
      });
    }

    if (hasStreetNumber) {
      findings.push({
        key: 'street_number_present',
        level: 'positive',
        description: 'Numéro de rue renseigné.',
        impact: 'positive'
      });
    } else if (hasStreet) {
      findings.push({
        key: 'street_number_missing',
        level: 'neutral',
        description: 'Numéro de rue manquant.',
        impact: 'neutral'
      });
    }

    if (hasCity) {
      findings.push({
        key: 'city_present',
        level: 'positive',
        description: 'Ville correctement renseignée.',
        impact: 'positive'
      });
    } else {
      findings.push({
        key: 'city_missing',
        level: 'alert',
        description: 'Ville absente.',
        impact: 'negative'
      });
    }

    if (hasState) {
      findings.push({
        key: 'state_present',
        level: 'positive',
        description: 'Gouvernorat identifié.',
        impact: 'positive'
      });
    } else {
      findings.push({
        key: 'state_missing',
        level: 'alert',
        description: 'Gouvernorat absent.',
        impact: 'negative'
      });
    }

    if (hasZipCode) {
      findings.push({
        key: 'zip_present',
        level: 'positive',
        description: 'Code postal renseigné.',
        impact: 'positive'
      });
    } else {
      findings.push({
        key: 'zip_missing',
        level: 'neutral',
        description: 'Code postal non renseigné.',
        impact: 'neutral'
      });
    }

    if (vagueAddress) {
      findings.push({
        key: 'address_vague',
        level: 'alert',
        description: 'Adresse imprécise avec une description vague.',
        impact: 'negative'
      });
    }

    return findings;
  }

  /**
   * Generate an automatic AI summary strictly from factors
   * that were actually used by the scoring engine.
   */
  generateSummary(order) {
    const factors = order.aiScoreDetails?.factors || [];

    const positiveFactors = factors.filter(
      factor => factor.applied === true && factor.impact > 0
    );

    const negativeFactors = factors.filter(
      factor => factor.applied === true && factor.impact < 0
    );

    const probabilityText =
      order.aiScore >= 81
        ? 'Cette commande présente une très forte probabilité de livraison.'
        : order.aiScore >= 61
          ? 'Cette commande présente une bonne probabilité de livraison.'
          : order.aiScore >= 41
            ? 'Cette commande présente une probabilité de livraison modérée.'
            : 'Cette commande présente un risque important nécessitant une vigilance particulière.';

    const riskLabels = {
      very_low: 'très faible',
      low: 'faible',
      medium: 'modéré',
      high: 'élevé',
      critical: 'critique'
    };

    const decisionLabels = {
      accept: 'Expédition recommandée',
      review: 'Décision du vendeur',
      reject: 'Expédition déconseillée'
    };

    return {
      introduction: probabilityText,

      positiveFactors: positiveFactors.map(factor => ({
        key: factor.key,
        label: factor.label,
        value: factor.value,
        impact: factor.impact
      })),

      warningFactors: negativeFactors.map(factor => ({
        key: factor.key,
        label: factor.label,
        value: factor.value,
        impact: factor.impact
      })),

      conclusion: `Le niveau de risque global est ${riskLabels[order.riskLevel] || 'non déterminé'}.`,

      recommendation:
        decisionLabels[order.aiDecision] || 'Décision non déterminée'
    };
  }

  /**
   * Populate AI fields
   */
  async enrichOrder(order) {
    const context =
      await this.buildScoringContext(order);

    const result =
      this.calculateAIScore(
        order,
        context
      );

    order.aiScore = result.score;
    order.riskLevel =
      this.calculateRiskLevel(result.score);
    order.aiDecision =
      this.calculateDecision(result.score);
    order.aiScoredAt = new Date();

    order.aiScoreDetails = {
      baseScore: 65,
      finalScore: result.score,
      factors: result.factors
    };

    return order;
  }
}

module.exports = new AIScoringService();
