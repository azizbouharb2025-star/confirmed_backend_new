function rangeRule({
  key,
  label,
  min,
  max,
  impact,
  order,
  includeMin = true,
  includeMax = false,
  enabled = true
}) {
  return {
    key,
    label,
    enabled,
    min,
    max,
    includeMin,
    includeMax,
    impact,
    order
  };
}

function answer(
  key,
  label,
  impact,
  order
) {
  return {
    key,
    label,
    impact,
    active: true,
    order
  };
}

function buildDefaultAIScoringConfig() {
  return {
    version: 1,
    status: 'draft',

    // ======================================================
    // PARAMETRES GENERAUX
    // ======================================================

    general: {
      baseScore: 65,
      minimumScore: 20,
      maximumScore: 97
    },

    // ======================================================
    // PATTERNS DE LA COMMANDE
    // ======================================================

    patterns: {
      enabled: true,

      // ----------------------------------------------------
      // ADRESSE
      // ----------------------------------------------------

      address: {
        enabled: true,

        /*
         * Default = exclusive to avoid accidental
         * double counting between address level
         * and detailed address elements.
         */
        mode: 'exclusive',

        elements: {
          street: {
            enabled: true,
            impact: 2,
            priority: 101
          },

          city: {
            enabled: true,
            impact: 2,
            priority: 102
          },

          governorate: {
            enabled: true,
            impact: 1,
            priority: 103
          },

          postalCode: {
            enabled: false,
            impact: 1,
            priority: 104
          }
        },

        levels: [
          {
            key: 'complete',
            label: 'Adresse complète',
            enabled: true,
            impact: 6,
            priority: 1
          },

          {
            key: 'partial',
            label: 'Adresse partielle',
            enabled: true,
            impact: -3,
            priority: 2
          },

          {
            key: 'missing',
            label: 'Adresse absente',
            enabled: true,
            impact: -10,
            priority: 3
          }
        ]
      },

      // ----------------------------------------------------
      // ZONE GEOGRAPHIQUE
      //
      // The specification gives governorate values as
      // examples, not mandatory defaults.
      // Admin will configure these dynamically.
      // ----------------------------------------------------

      geographicZone: {
        enabled: true,
        rules: []
      },

      // ----------------------------------------------------
      // VALEUR DE COMMANDE
      // ----------------------------------------------------

      orderValue: {
        enabled: true,

        /*
         * The specification defines the situations and
         * impacts but not their numerical ratio thresholds.
         *
         * These thresholds preserve the existing Confirmed
         * V1 behavior and become editable configuration.
         */
        relativeToHistory: {
          enabled: true,
          minimumHistoricalOrders: 3,

          rules: [
            rangeRule({
              key: 'very_low',
              label:
                'Très faible / inhabituelle',
              min: 0,
              max: 0.5,
              includeMin: true,
              includeMax: false,
              impact: -1,
              order: 1
            }),

            rangeRule({
              key: 'normal',
              label: 'Valeur normale',
              min: 0.5,
              max: 1.25,
              includeMin: true,
              includeMax: true,
              impact: 0,
              order: 2
            }),

            rangeRule({
              key: 'slightly_above',
              label:
                'Légèrement supérieure à la moyenne',
              min: 1.25,
              max: 1.5,
              includeMin: false,
              includeMax: true,
              impact: -1,
              order: 3
            }),

            rangeRule({
              key: 'high',
              label: 'Élevée',
              min: 1.5,
              max: 2,
              includeMin: false,
              includeMax: true,
              impact: -3,
              order: 4
            }),

            rangeRule({
              key: 'very_high',
              label: 'Très élevée',
              min: 2,
              max: null,
              includeMin: false,
              includeMax: true,
              impact: -5,
              order: 5
            })
          ]
        },

        absoluteValue: {
          enabled: true,

          rules: [
            rangeRule({
              key: 'under_30',
              label: '< 30 DT',
              min: 0,
              max: 30,
              impact: -1,
              order: 1
            }),

            rangeRule({
              key: '30_99',
              label: '30–99 DT',
              min: 30,
              max: 100,
              impact: 0,
              order: 2
            }),

            rangeRule({
              key: '100_149',
              label: '100–149 DT',
              min: 100,
              max: 150,
              impact: 0,
              order: 3
            }),

            rangeRule({
              key: '150_249',
              label: '150–249 DT',
              min: 150,
              max: 250,
              impact: -1,
              order: 4
            }),

            rangeRule({
              key: '250_399',
              label: '250–399 DT',
              min: 250,
              max: 400,
              impact: -3,
              order: 5
            }),

            rangeRule({
              key: '400_599',
              label: '400–599 DT',
              min: 400,
              max: 600,
              impact: -5,
              order: 6
            }),

            rangeRule({
              key: '600_plus',
              label: '≥ 600 DT',
              min: 600,
              max: null,
              includeMin: true,
              includeMax: true,
              impact: -6,
              order: 7
            })
          ]
        }
      },

      // ----------------------------------------------------
      // HEURE DE COMMANDE
      // ----------------------------------------------------

      orderTime: {
        enabled: true,

        rules: [
          {
            key: '00_02',
            label: '00:00–02:00',
            enabled: true,
            startMinute: 0,
            endMinute: 120,
            impact: -2,
            order: 1
          },

          {
            key: '02_06',
            label: '02:00–06:00',
            enabled: true,
            startMinute: 120,
            endMinute: 360,
            impact: -3,
            order: 2
          },

          {
            key: '06_08',
            label: '06:00–08:00',
            enabled: true,
            startMinute: 360,
            endMinute: 480,
            impact: -1,
            order: 3
          },

          {
            key: '08_22',
            label: '08:00–22:00',
            enabled: true,
            startMinute: 480,
            endMinute: 1320,
            impact: 0,
            order: 4
          },

          {
            key: '22_24',
            label: '22:00–00:00',
            enabled: true,
            startMinute: 1320,
            endMinute: 1440,
            impact: -1,
            order: 5
          }
        ],

        /*
         * Compatibility values from the existing engine.
         * The specification requires this historical signal
         * to be configurable but does not specify these
         * detection thresholds.
         */
        historicalSignal: {
          enabled: true,
          minimumCompletedOrders: 5,
          minimumFailureRate: 30,
          minimumExcessFailureRate: 15,
          impact: -3
        }
      }
    },

    // ======================================================
    // HISTORIQUE CLIENT
    // ======================================================

    customerHistory: {
      enabled: true,

      successfulDeliveries: {
        enabled: true,

        rules: [
          rangeRule({
            key: 'success_0',
            label:
              'Nouveau client / aucune donnée',
            min: 0,
            max: 1,
            impact: 0,
            order: 1
          }),

          rangeRule({
            key: 'success_1',
            label: '1 livraison réussie',
            min: 1,
            max: 2,
            impact: 2,
            order: 2
          }),

          rangeRule({
            key: 'success_2_3',
            label:
              '2–3 livraisons réussies',
            min: 2,
            max: 4,
            impact: 4,
            order: 3
          }),

          rangeRule({
            key: 'success_4_6',
            label:
              '4–6 livraisons réussies',
            min: 4,
            max: 7,
            impact: 6,
            order: 4
          }),

          rangeRule({
            key: 'success_7_10',
            label:
              '7–10 livraisons réussies',
            min: 7,
            max: 11,
            impact: 8,
            order: 5
          }),

          rangeRule({
            key: 'success_11_plus',
            label:
              '11+ livraisons réussies',
            min: 11,
            max: null,
            includeMin: true,
            includeMax: true,
            impact: 10,
            order: 6
          })
        ]
      },

      failedDeliveries: {
        enabled: true,

        rules: [
          rangeRule({
            key: 'failure_0',
            label: 'Aucun échec',
            min: 0,
            max: 1,
            impact: 0,
            order: 1
          }),

          rangeRule({
            key: 'failure_1',
            label: '1 échec',
            min: 1,
            max: 2,
            impact: -3,
            order: 2
          }),

          rangeRule({
            key: 'failure_2',
            label: '2 échecs',
            min: 2,
            max: 3,
            impact: -6,
            order: 3
          }),

          rangeRule({
            key: 'failure_3',
            label: '3 échecs',
            min: 3,
            max: 4,
            impact: -9,
            order: 4
          }),

          rangeRule({
            key: 'failure_4_5',
            label: '4–5 échecs',
            min: 4,
            max: 6,
            impact: -12,
            order: 5
          }),

          rangeRule({
            key: 'failure_6_plus',
            label: '6+ échecs',
            min: 6,
            max: null,
            includeMin: true,
            includeMax: true,
            impact: -15,
            order: 6
          })
        ]
      }
    },

    // ======================================================
    // FEEDBACK OPERATEUR
    // ======================================================

    operatorFeedback: {
      enabled: true,

      categories: [
        {
          key: 'general',
          label: 'Général',
          active: true,
          order: 1
        }
      ],

      questions: [
        // ==================================================
        // A. TON ET COMPORTEMENT
        // ==================================================

        {
          key: 'tone_behavior',
          categoryKey: 'general',

          title: 'Ton et comportement',

          prompt:
            'Quelles observations décrivent le ton et le comportement du client ?',

          type: 'multiple_choice',
          active: true,
          required: false,
          maxSelections: 3,
          order: 1,

          answers: [
            answer(
              'polite',
              'Poli et courtois',
              1,
              1
            ),

            answer(
              'confident',
              'Confiant',
              1,
              2
            ),

            answer(
              'enthusiastic',
              'Enthousiaste',
              1,
              3
            ),

            answer(
              'quick_response',
              'Réponse rapide',
              1,
              4
            ),

            answer(
              'hesitant',
              'Hésitant',
              -1,
              5
            ),

            answer(
              'distracted',
              'Distrait',
              -1,
              6
            ),

            answer(
              'long_pauses',
              'Longues pauses',
              -1,
              7
            ),

            answer(
              'rude',
              'Impoli',
              -2,
              8
            ),

            answer(
              'aggressive',
              'Agressif',
              -2,
              9
            ),

            answer(
              'nervous',
              'Ton nerveux',
              -1,
              10
            ),

            answer(
              'low_interest',
              'Semble peu intéressé',
              -2,
              11
            )
          ]
        },

        // ==================================================
        // B. NIVEAU DE CONFIRMATION
        // ==================================================

        {
          key: 'confirmation_level',
          categoryKey: 'general',

          title:
            'Niveau de confirmation',

          prompt:
            'Comment évaluez-vous le niveau de confirmation du client ?',

          type: 'single_choice',
          active: true,
          required: false,
          maxSelections: null,
          order: 2,

          answers: [
            answer(
              'very_firm',
              'Confirmation très ferme',
              5,
              1
            ),

            answer(
              'normal',
              'Confirmation normale',
              2,
              2
            ),

            answer(
              'weak',
              'Confirmation faible',
              -4,
              3
            )
          ]
        },

        // ==================================================
        // C. COMPORTEMENT FACE AU PRIX
        // ==================================================

        {
          key: 'price_behavior',
          categoryKey: 'general',

          title:
            'Comportement face au prix',

          prompt:
            'Comment le client réagit-il au prix ?',

          type: 'single_choice',
          active: true,
          required: false,
          maxSelections: null,
          order: 3,

          answers: [
            answer(
              'no_issue',
              'Aucun problème concernant le prix',
              1,
              1
            ),

            answer(
              'asks_discount',
              'Demande une réduction',
              -1,
              2
            ),

            answer(
              'insists_discount',
              'Insiste pour obtenir une réduction',
              -3,
              3
            ),

            answer(
              'strong_negotiation',
              'Négocie fortement le prix',
              -4,
              4
            )
          ]
        },

        // ==================================================
        // D. DOUTES SUR LE PRODUIT
        // ==================================================

        {
          key: 'product_doubts',
          categoryKey: 'general',

          title: 'Doutes sur le produit',

          prompt:
            'Le client exprime-t-il des doutes sur le produit ?',

          type: 'single_choice',
          active: true,
          required: false,
          maxSelections: null,
          order: 4,

          answers: [
            answer(
              'none',
              'Aucun doute',
              1,
              1
            ),

            answer(
              'asks_question',
              'Pose une question sur le produit',
              0,
              2
            ),

            answer(
              'multiple_doubts',
              'Exprime plusieurs doutes',
              -2,
              3
            ),

            answer(
              'compares_seller',
              'Compare avec un autre vendeur',
              -3,
              4
            )
          ]
        },

        // ==================================================
        // E. INFORMATIONS DE LIVRAISON
        // ==================================================

        {
          key: 'delivery_information',
          categoryKey: 'general',

          title:
            'Informations de livraison',

          prompt:
            'Comment le client fournit-il ses informations de livraison ?',

          type: 'single_choice',
          active: true,
          required: false,
          maxSelections: null,
          order: 5,

          answers: [
            answer(
              'complete_quick',
              'Adresse complète et fournie rapidement',
              4,
              1
            ),

            answer(
              'clear_precise',
              'Adresse claire et précise',
              3,
              2
            ),

            answer(
              'partial',
              'Adresse partiellement renseignée',
              -1,
              3
            ),

            answer(
              'vague',
              'Adresse vague',
              -3,
              4
            ),

            answer(
              'difficulty',
              'Difficulté à fournir les informations',
              -4,
              5
            ),

            answer(
              'refuses_details',
              'Refuse / évite de communiquer les détails',
              -5,
              6
            )
          ]
        },

        // ==================================================
        // F. NIVEAU D'ENGAGEMENT
        // ==================================================

        {
          key: 'engagement_level',
          categoryKey: 'general',

          title: "Niveau d'engagement",

          prompt:
            "Comment évaluez-vous le niveau d'engagement du client ?",

          type: 'single_choice',
          active: true,
          required: false,
          maxSelections: null,
          order: 6,

          answers: [
            answer(
              'very_engaged',
              'Très engagé',
              3,
              1
            ),

            answer(
              'interested',
              'Intéressé',
              2,
              2
            ),

            answer(
              'passive',
              'Passif',
              0,
              3
            ),

            answer(
              'low_involvement',
              'Peu impliqué',
              -2,
              4
            ),

            answer(
              'distracted',
              'Distrait',
              -3,
              5
            )
          ]
        },

        // ==================================================
        // G. INTENTION DE RECEPTION
        // ==================================================

        {
          key: 'reception_intent',
          categoryKey: 'general',

          title: 'Intention de réception',

          prompt:
            'Quelle est l’intention de réception exprimée par le client ?',

          type: 'single_choice',
          active: true,
          required: false,
          maxSelections: null,
          order: 7,

          answers: [
            answer(
              'no_information',
              'Aucune information',
              0,
              1
            ),

            answer(
              'wants_fast_delivery',
              'Souhaite recevoir rapidement',
              3,
              2
            ),

            answer(
              'clearly_confirms_receipt',
              'Confirme clairement la réception',
              3,
              3
            ),

            answer(
              'asks_delivery_info',
              'Demande des informations sur la livraison',
              1,
              4
            ),

            answer(
              'uncertain_receipt',
              'Incertain concernant la réception',
              -2,
              5
            ),

            answer(
              'does_not_know_when',
              'Ne sait pas quand il pourra recevoir',
              -3,
              6
            )
          ]
        }
      ]
    },

    notes:
      'Configuration initiale V1. Les règles sont stockées comme configuration modifiable. Les seuils relatifs au montant historique et au signal horaire historique reprennent le comportement existant lorsque la spécification ne fournit pas de seuil numérique.'
  };
}

module.exports = {
  buildDefaultAIScoringConfig
};
