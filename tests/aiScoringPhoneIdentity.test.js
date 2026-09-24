jest.mock('../src/models/Order', () => ({
  countDocuments: jest.fn(),
  aggregate: jest.fn()
}));

const Order = require('../src/models/Order');
const aiScoringService = require(
  '../src/services/aiScoringService'
);

describe('AI scoring customer phone identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it(
    'construit une recherche multi-téléphones unique',
    async () => {
      Order.countDocuments
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(1);

      Order.aggregate.mockResolvedValueOnce([
        {
          orderCount: 4,
          averageOrderValue: 250
        }
      ]);

      const hourSpy = jest
        .spyOn(
          aiScoringService,
          'getTunisiaOrderHour'
        )
        .mockReturnValue(null);

      const order = {
        _id: 'current-order',
        shopId: 'shop-one',

        clientInfo: {
          phone: '55 111 111',

          additionalPhones: [
            '66-222-222'
          ],

          address: {}
        },

        deliveryInfo: {
          secondaryPhone: '77 333 333'
        }
      };

      const context =
        await aiScoringService
          .buildScoringContext(order);

      hourSpy.mockRestore();

      /*
       * Une seule requête par statut :
       * MongoDB compte chaque document une seule fois,
       * même si plusieurs branches du $or correspondent.
       */
      expect(
        Order.countDocuments
      ).toHaveBeenCalledTimes(2);

      expect(
        Order.aggregate
      ).toHaveBeenCalledTimes(1);

      const successQuery =
        Order.countDocuments.mock.calls[0][0];

      const failureQuery =
        Order.countDocuments.mock.calls[1][0];

      expect(successQuery.shopId).toBe('shop-one');

      expect(successQuery._id).toEqual({
        $ne: 'current-order'
      });

      expect(successQuery.status).toBe('delivered');

      expect(failureQuery.status).toBe(
        'failed_delivery'
      );

      /*
       * 3 identités téléphoniques multipliées par
       * 3 champs historiques = 9 branches.
       */
      expect(successQuery.$or).toHaveLength(9);

      const queryMatches = (
        field,
        historicalValue
      ) =>
        successQuery.$or.some(condition => {
          const regex = condition[field];

          return (
            regex instanceof RegExp &&
            regex.test(historicalValue)
          );
        });

      // Secondaire actuel -> principal historique.
      expect(
        queryMatches(
          'clientInfo.phone',
          '+216 77 333 333'
        )
      ).toBe(true);

      // Principal actuel -> supplémentaire historique.
      expect(
        queryMatches(
          'clientInfo.additionalPhones',
          '00216 55 111 111'
        )
      ).toBe(true);

      // Supplémentaire actuel -> secondaire historique.
      expect(
        queryMatches(
          'deliveryInfo.secondaryPhone',
          '216 66 222 222'
        )
      ).toBe(true);

      expect(context.customerHistory).toEqual({
        successfulDeliveries: 3,
        failedDeliveries: 1
      });

      expect(context.orderValueHistory).toEqual({
        orderCount: 4,
        averageOrderValue: 250
      });
    }
  );
});
