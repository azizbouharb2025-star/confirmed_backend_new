const buildInitialCarrierStatusMappings = () => ({
  intigo: [
    {
      matchType: 'exact',
      code: 99,
      label: 'Réacheminement',
      mappedOrderStatus: 'out_for_delivery',
      enabled: true,
      order: 0
    },

    {
      matchType: 'range',
      rangeStart: 1000,
      rangeEnd: 1008,
      label: 'Pickup vendeur',
      mappedOrderStatus: 'shipped',
      enabled: true,
      order: 1
    },

    {
      matchType: 'range',
      rangeStart: 1100,
      rangeEnd: 1102,
      label: 'Annulation pickup',
      mappedOrderStatus: 'cancelled',
      enabled: true,
      order: 2
    },

    {
      matchType: 'exact',
      code: 2000,
      label: 'Entrepôt',
      mappedOrderStatus: 'at_depot',
      enabled: true,
      order: 3
    },

    {
      matchType: 'exact',
      code: 2001,
      label: 'Entrepôt / relance',
      mappedOrderStatus: 'at_depot',
      enabled: true,
      order: 4
    },

    {
      matchType: 'exact',
      code: 2004,
      label: 'Reçu entrepôt',
      mappedOrderStatus: 'at_depot',
      enabled: true,
      order: 5
    },

    {
      matchType: 'exact',
      code: 2100,
      label: 'Vérification entrepôt',
      mappedOrderStatus: 'at_depot',
      enabled: true,
      order: 6
    },

    {
      matchType: 'exact',
      code: 3100,
      label: 'Transfert vers livraison',
      mappedOrderStatus: 'out_for_delivery',
      enabled: true,
      order: 7
    },

    {
      matchType: 'exact',
      code: 3201,
      label: 'Transfert retour',
      mappedOrderStatus: 'returned',
      enabled: true,
      order: 8
    },

    {
      matchType: 'exact',
      code: 4000,
      label: 'Chez le livreur',
      mappedOrderStatus: 'out_for_delivery',
      enabled: true,
      order: 9
    },

    {
      matchType: 'exact',
      code: 5000,
      label: 'Livraison réussie',
      mappedOrderStatus: 'delivered',
      enabled: true,
      order: 10
    },

    {
      matchType: 'exact',
      code: 6000,
      label: 'Retour',
      mappedOrderStatus: 'returned',
      enabled: true,
      order: 11
    },

    {
      matchType: 'exact',
      code: 6001,
      label: 'Retour',
      mappedOrderStatus: 'returned',
      enabled: true,
      order: 12
    },

    {
      matchType: 'exact',
      code: 6500,
      label: 'Retour',
      mappedOrderStatus: 'returned',
      enabled: true,
      order: 13
    },

    {
      matchType: 'exact',
      code: 6900,
      label: 'Retour',
      mappedOrderStatus: 'returned',
      enabled: true,
      order: 14
    },

    {
      matchType: 'range',
      rangeStart: 9000,
      rangeEnd: 9004,
      label: 'Annulation définitive',
      mappedOrderStatus: 'cancelled',
      enabled: true,
      order: 15
    }
  ],

  colissimo: [
    {
      providerStatus: 'Livre',
      label: 'Livré',
      mappedOrderStatus: 'delivered',
      enabled: true,
      order: 0
    },

    {
      providerStatus: 'Livre paye',
      label: 'Livré payé',
      mappedOrderStatus: 'delivered',
      enabled: true,
      order: 1
    },

    {
      providerStatus: 'Au depot',
      label: 'Au dépôt',
      mappedOrderStatus: 'at_depot',
      enabled: true,
      order: 2
    },

    {
      providerStatus: 'Retour depot',
      label: 'Retour dépôt',
      mappedOrderStatus: 'at_depot',
      enabled: true,
      order: 3
    },


    {
      providerStatus: 'En cours',
      label: 'En cours de livraison',
      mappedOrderStatus: 'out_for_delivery',
      enabled: true,
      order: 4
    },

    {
      providerStatus: 'Retour expediteur',
      label: 'Retour expéditeur',
      mappedOrderStatus: 'returned',
      enabled: true,
      order: 5
    },

    {
      providerStatus: 'Retour inter agence',
      label: 'Retour inter agence',
      mappedOrderStatus: 'returned',
      enabled: true,
      order: 6
    },

    {
      providerStatus: 'Retour paye',
      label: 'Retour payé',
      mappedOrderStatus: 'returned',
      enabled: true,
      order: 7
    },

    {
      providerStatus: 'Retour definitif',
      label: 'Retour définitif',
      mappedOrderStatus: 'returned',
      enabled: true,
      order: 8
    },

    {
      providerStatus: 'Retour recu paye',
      label: 'Retour reçu payé',
      mappedOrderStatus: 'returned',
      enabled: true,
      order: 9
    },

    {
      providerStatus: 'En attente',
      label: 'En attente',
      mappedOrderStatus: null,
      enabled: true,
      order: 10
    },

    {
      providerStatus: 'Echange',
      label: 'Échange',
      mappedOrderStatus: null,
      enabled: true,
      order: 11
    },

    {
      providerStatus: 'Supprime',
      label: 'Supprimé',
      mappedOrderStatus: null,
      enabled: true,
      order: 12
    },

    {
      providerStatus: 'Non recu',
      label: 'Non reçu',
      mappedOrderStatus: null,
      enabled: true,
      order: 13
    },

    {
      providerStatus: 'A enlever',
      label: 'À enlever',
      mappedOrderStatus: null,
      enabled: true,
      order: 14
    },

    {
      providerStatus: 'Enleve',
      label: 'Enlevé',
      mappedOrderStatus: null,
      enabled: true,
      order: 15
    },

    {
      providerStatus: 'A verifier',
      label: 'À vérifier',
      mappedOrderStatus: null,
      enabled: true,
      order: 16
    },

    {
      providerStatus: 'Inconnu',
      label: 'Inconnu',
      mappedOrderStatus: null,
      enabled: true,
      order: 17
    }
  ]
});


module.exports = {
  buildInitialCarrierStatusMappings
};
