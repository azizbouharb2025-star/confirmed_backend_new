const AIScoringConfig =
  require('../models/AIScoringConfig');

class AIScoringConfigService {
  /**
   * Load the configuration currently used for scoring.
   *
   * Only one configuration can be active because MongoDB
   * already has a unique partial index on status=active.
   */
  async getActiveConfig() {
    const config =
      await AIScoringConfig
        .findOne({
          status: 'active'
        })
        .select({
          version: 1,
          general: 1,
          patterns: 1,
          customerHistory: 1,
          operatorFeedback: 1
        })
        .lean();

    if (!config) {
      return null;
    }

    return config;
  }

  /**
   * Build an immutable plain snapshot of the scoring
   * configuration used for an order.
   *
   * We intentionally keep only fields that can influence
   * scoring. Admin metadata such as createdBy, activatedBy,
   * timestamps and status are not needed in each order.
   */
  createSnapshot(config) {
    if (!config) {
      return null;
    }

    const snapshot = {
      version: config.version,
      general: config.general,
      patterns: config.patterns,
      customerHistory:
        config.customerHistory,
      operatorFeedback:
        config.operatorFeedback
    };

    /*
     * Deep-copy the object so future in-memory changes
     * cannot mutate the snapshot attached to an order.
     */
    return JSON.parse(
      JSON.stringify(snapshot)
    );
  }

  /**
   * Convenience method used later by the scoring engine.
   *
   * One database read gives us both:
   * - the active configuration;
   * - the exact snapshot to store with the order.
   */
  async getActiveScoringContext() {
    const config =
      await this.getActiveConfig();

    if (!config) {
      return {
        config: null,
        snapshot: null
      };
    }

    return {
      config,
      snapshot:
        this.createSnapshot(config)
    };
  }
}

module.exports =
  new AIScoringConfigService();
