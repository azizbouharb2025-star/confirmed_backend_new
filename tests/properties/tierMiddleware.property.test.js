const fc = require('fast-check');
const mongoose = require('mongoose');
const { getTierFilters, tierMeetsMinimum, TIER_HIERARCHY } = require('../../src/middleware/tierCheck');

/**
 * Property tests for Tier Middleware
 * Tests tier-based filtering logic for the Orders API
 */

// Arbitrary generators
const tierArbitrary = fc.constantFrom('free', 'pro', 'business', 'enterprise');
const aiScoreArbitrary = fc.integer({ min: 0, max: 100 });
const regionArbitrary = fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0);
const courierArbitrary = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);

// Generate query with AI score filters
const aiScoreQueryArbitrary = fc.record({
  aiScoreMin: fc.option(aiScoreArbitrary, { nil: undefined }),
  aiScoreMax: fc.option(aiScoreArbitrary, { nil: undefined }),
  page: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
  limit: fc.option(fc.integer({ min: 1, max: 50 }), { nil: undefined })
}).map(q => {
  // Ensure aiScoreMin <= aiScoreMax when both are defined
  if (q.aiScoreMin !== undefined && q.aiScoreMax !== undefined && q.aiScoreMin > q.aiScoreMax) {
    [q.aiScoreMin, q.aiScoreMax] = [q.aiScoreMax, q.aiScoreMin];
  }
  return q;
});

// Generate query with region filter
const regionQueryArbitrary = fc.record({
  region: fc.option(regionArbitrary, { nil: undefined }),
  page: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
  limit: fc.option(fc.integer({ min: 1, max: 50 }), { nil: undefined })
});

// Generate query with courier filter
const courierQueryArbitrary = fc.record({
  courier: fc.option(courierArbitrary, { nil: undefined }),
  page: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
  limit: fc.option(fc.integer({ min: 1, max: 50 }), { nil: undefined })
});

describe('Tier Middleware Property Tests', () => {
  /**
   * **Feature: orders-api-enhancement, Property 19: Pro Tier AI Score Filter**
   * *For any* Pro+ tier user with aiScoreMin and aiScoreMax filters, all returned orders 
   * SHALL have `aiRiskScore` >= aiScoreMin AND `aiRiskScore` <= aiScoreMax.
   * **Validates: Requirements 7.1**
   */
  describe('Property 19: Pro Tier AI Score Filter', () => {
    it('should preserve AI score filters for Pro+ tier users', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('pro', 'business', 'enterprise'),
          aiScoreQueryArbitrary,
          async (tier, query) => {
            // Execute
            const filteredQuery = getTierFilters(tier, query);

            // Verify: Pro+ tiers should preserve AI score filters
            if (query.aiScoreMin !== undefined) {
              expect(filteredQuery.aiScoreMin).toBe(query.aiScoreMin);
            }
            if (query.aiScoreMax !== undefined) {
              expect(filteredQuery.aiScoreMax).toBe(query.aiScoreMax);
            }
            
            // Non-tier filters should always be preserved
            if (query.page !== undefined) {
              expect(filteredQuery.page).toBe(query.page);
            }
            if (query.limit !== undefined) {
              expect(filteredQuery.limit).toBe(query.limit);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * **Feature: orders-api-enhancement, Property 20: Non-Pro Tier AI Score Filter Ignored**
   * *For any* non-Pro tier user with aiScoreMin/aiScoreMax parameters, the returned orders 
   * SHALL be identical to a request without those parameters.
   * **Validates: Requirements 7.2**
   */
  describe('Property 20: Non-Pro Tier AI Score Filter Ignored', () => {
    it('should remove AI score filters for non-Pro tier users', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constant('free'),
          aiScoreQueryArbitrary,
          async (tier, query) => {
            // Execute
            const filteredQuery = getTierFilters(tier, query);

            // Verify: Free tier should NOT have AI score filters
            expect(filteredQuery.aiScoreMin).toBeUndefined();
            expect(filteredQuery.aiScoreMax).toBeUndefined();
            
            // Non-tier filters should still be preserved
            if (query.page !== undefined) {
              expect(filteredQuery.page).toBe(query.page);
            }
            if (query.limit !== undefined) {
              expect(filteredQuery.limit).toBe(query.limit);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should produce same result as query without AI score params for free tier', async () => {
      await fc.assert(
        fc.asyncProperty(
          aiScoreQueryArbitrary,
          async (query) => {
            const tier = 'free';
            
            // Create query without AI score params
            const queryWithoutAiScore = { ...query };
            delete queryWithoutAiScore.aiScoreMin;
            delete queryWithoutAiScore.aiScoreMax;

            // Execute both
            const filteredWithAiScore = getTierFilters(tier, query);
            const filteredWithoutAiScore = getTierFilters(tier, queryWithoutAiScore);

            // Verify: Results should be identical
            expect(filteredWithAiScore).toEqual(filteredWithoutAiScore);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: orders-api-enhancement, Property 21: Business Tier Region Filter**
   * *For any* Business+ tier user with region filter, all returned orders SHALL have 
   * `region` equal to the filter value.
   * **Validates: Requirements 8.1**
   */
  describe('Property 21: Business Tier Region Filter', () => {
    it('should preserve region filter for Business+ tier users', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('business', 'enterprise'),
          regionQueryArbitrary,
          async (tier, query) => {
            // Execute
            const filteredQuery = getTierFilters(tier, query);

            // Verify: Business+ tiers should preserve region filter
            if (query.region !== undefined) {
              expect(filteredQuery.region).toBe(query.region);
            }
            
            // Non-tier filters should always be preserved
            if (query.page !== undefined) {
              expect(filteredQuery.page).toBe(query.page);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should remove region filter for non-Business tier users', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('free', 'pro'),
          regionQueryArbitrary,
          async (tier, query) => {
            // Execute
            const filteredQuery = getTierFilters(tier, query);

            // Verify: Free and Pro tiers should NOT have region filter
            expect(filteredQuery.region).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: orders-api-enhancement, Property 22: Business Tier Courier Filter**
   * *For any* Business+ tier user with courier filter, all returned orders SHALL have 
   * `courierAssignment.courierName` equal to the filter value.
   * **Validates: Requirements 8.2**
   */
  describe('Property 22: Business Tier Courier Filter', () => {
    it('should preserve courier filter for Business+ tier users', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('business', 'enterprise'),
          courierQueryArbitrary,
          async (tier, query) => {
            // Execute
            const filteredQuery = getTierFilters(tier, query);

            // Verify: Business+ tiers should preserve courier filter
            if (query.courier !== undefined) {
              expect(filteredQuery.courier).toBe(query.courier);
            }
            
            // Non-tier filters should always be preserved
            if (query.page !== undefined) {
              expect(filteredQuery.page).toBe(query.page);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should remove courier filter for non-Business tier users', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('free', 'pro'),
          courierQueryArbitrary,
          async (tier, query) => {
            // Execute
            const filteredQuery = getTierFilters(tier, query);

            // Verify: Free and Pro tiers should NOT have courier filter
            expect(filteredQuery.courier).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Additional property: Tier hierarchy is respected
   */
  describe('Tier Hierarchy Properties', () => {
    it('should correctly determine tier hierarchy', async () => {
      await fc.assert(
        fc.asyncProperty(
          tierArbitrary,
          tierArbitrary,
          async (tier1, tier2) => {
            const index1 = TIER_HIERARCHY.indexOf(tier1);
            const index2 = TIER_HIERARCHY.indexOf(tier2);
            
            // tierMeetsMinimum should be consistent with hierarchy
            const meetsMinimum = tierMeetsMinimum(tier1, tier2);
            expect(meetsMinimum).toBe(index1 >= index2);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
