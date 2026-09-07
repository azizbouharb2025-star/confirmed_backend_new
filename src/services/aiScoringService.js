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
    if (!feedback) {
      return {
        adjustment: 0,
        applied: false,
        summary: ''
      };
    }

    let raw = 0;

    const toneWeights = {
      polite: 1,
      confident: 1,
      enthusiastic: 1,
      quick_response: 1,

      hesitant: -1,
      distracted: -2,
      long_pauses: -2,
      rude: -3,
      aggressive: -3,
      nervous: -2,
      low_interest: -2
    };

    const toneRaw = Array.isArray(
      feedback.toneSignals
    )
      ? feedback.toneSignals.reduce(
          (total, signal) =>
            total + (toneWeights[signal] || 0),
          0
        )
      : 0;

    // Les signaux de ton ne peuvent pas dominer seuls.
    raw += Math.max(
      -4,
      Math.min(4, toneRaw)
    );

    const confirmationWeights = {
      very_firm: 5,
      normal: 2,
      weak: -5
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
      multiple_doubts: -4,
      compares_seller: -2
    };

    const deliveryWeights = {
      complete_quick: 4,
      clear_precise: 3,
      partial: -1,
      vague: -3,
      difficulty: -3,
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
      wants_fast_delivery: 2,
      clearly_confirms_receipt: 3,
      asks_delivery_info: 1,
      uncertain_receipt: -3,
      does_not_know_when: -4
    };

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

    const adjustment = Math.max(
      -15,
      Math.min(15, raw)
    );

    return {
      adjustment,
      applied: adjustment !== 0,
      summary:
        adjustment > 0
          ? 'Retour opérateur globalement favorable'
          : adjustment < 0
            ? 'Retour opérateur présentant des signaux de vigilance'
            : 'Retour opérateur globalement neutre'
    };
  }

  /**
   * Calculate AI score (0-100) and keep real scoring details
   */
  calculateAIScore(order) {
    let score = 50;

    const factors = [];

    // Order amount
    if (order.totalAmount >= 50 && order.totalAmount <= 300) {
      score += 20;

      factors.push({
        key: 'order_amount',
        label: 'Montant de la commande',
        value: order.totalAmount,
        impact: 20,
        applied: true
      });
    } else if (order.totalAmount < 10) {
      score -= 20;

      factors.push({
        key: 'order_amount',
        label: 'Montant de la commande',
        value: order.totalAmount,
        impact: -20,
        applied: true
      });
    } else if (order.totalAmount > 1000) {
      score -= 10;

      factors.push({
        key: 'order_amount',
        label: 'Montant de la commande',
        value: order.totalAmount,
        impact: -10,
        applied: true
      });
    } else {
      factors.push({
        key: 'order_amount',
        label: 'Montant de la commande',
        value: order.totalAmount,
        impact: 0,
        applied: false
      });
    }

    // Repeat buyer
    if (order.isRepeatBuyer) {
      score += 15;

      factors.push({
        key: 'repeat_buyer',
        label: 'Client récurrent',
        value: true,
        impact: 15,
        applied: true
      });
    } else {
      factors.push({
        key: 'repeat_buyer',
        label: 'Client récurrent',
        value: false,
        impact: 0,
        applied: false
      });
    }

    // Region
    const region = (order.region || '').toLowerCase();

    const trustedRegion = [
      'tunis',
      'sfax',
      'sousse',
      'ariana'
    ].some(r => region.includes(r));

    if (trustedRegion) {
      score += 10;

      factors.push({
        key: 'region',
        label: 'Région',
        value: order.region || '',
        impact: 10,
        applied: true
      });
    } else {
      factors.push({
        key: 'region',
        label: 'Région',
        value: order.region || '',
        impact: 0,
        applied: false
      });
    }

    /*
     * Retour comportemental opérateur.
     *
     * N'intervient qu'après une vraie confirmation
     * structurée.
     */
    const operatorBehavior =
      this.calculateOperatorFeedbackAdjustment(
        order.operatorFeedback
      );

    if (operatorBehavior.applied) {
      score += operatorBehavior.adjustment;

      factors.push({
        key: 'operator_feedback',
        label: 'Retour comportemental opérateur',
        value: operatorBehavior.summary,
        impact: operatorBehavior.adjustment,
        applied: true
      });
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

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
  enrichOrder(order) {
    const result = this.calculateAIScore(order);

    order.aiScore = result.score;
    order.riskLevel = this.calculateRiskLevel(result.score);
    order.aiDecision = this.calculateDecision(result.score);
    order.aiScoredAt = new Date();

    order.aiScoreDetails = {
      baseScore: 50,
      finalScore: result.score,
      factors: result.factors
    };

    return order;
  }
}

module.exports = new AIScoringService();
