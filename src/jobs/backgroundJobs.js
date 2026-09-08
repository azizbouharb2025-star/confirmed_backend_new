const cron =
  require('node-cron');

const aiService =
  require('../services/aiService');

const queueService =
  require('../services/queueService');

const logger =
  require('../utils/logger');

const {
  runScheduledJobOnce
} = require(
  '../utils/distributedJobLock'
);

const {
  runIntigoStatusSyncBatch
} = require(
  '../services/delivery/intigoAutoSyncService'
);

const MINUTE =
  60 * 1000;

const executeScheduledJob =
  async ({
    name,
    jobKey,
    windowMs,
    lockTtlMs,
    task
  }) => {
    try {
      const result =
        await runScheduledJobOnce({
          jobKey,
          windowMs,
          lockTtlMs,
          jobName: name,

          task:
            async () => {
              logger.info(
                `Running background job: ${name}`,
                {
                  instance:
                    process.env.NODE_APP_INSTANCE ??
                    null
                }
              );

              return task();
            }
        });

      if (
        result.executed === true
      ) {
        logger.info(
          `Background job completed: ${name}`,
          {
            instance:
              process.env.NODE_APP_INSTANCE ??
              null,

            mode:
              result.mode,

            bucket:
              result.bucket
          }
        );
      }
    } catch (error) {
      logger.error(
        `Background job failed: ${name}`,
        {
          message:
            error.message,

          stack:
            error.stack
        }
      );
    }
  };

class BackgroundJobs {
  start() {
    /*
     * IA : toutes les 5 minutes.
     */
    cron.schedule(
      '*/5 * * * *',
      async () => {
        await executeScheduledJob({
          name:
            'ai-call-queue',

          jobKey:
            'confirmed:jobs:ai-call-queue',

          windowMs:
            5 * MINUTE,

          /*
           * Empêche un second traitement si
           * le service IA reste bloqué longtemps.
           */
          lockTtlMs:
            15 * MINUTE,

          task:
            async () => {
              logger.info(
                'Processing AI call queue'
              );

              await aiService
                .processAIQueue();
            }
        });
      }
    );

    /*
     * Distribution : chaque minute.
     */
    cron.schedule(
      '* * * * *',
      async () => {
        await executeScheduledJob({
          name:
            'order-distribution',

          jobKey:
            'confirmed:jobs:order-distribution',

          windowMs:
            MINUTE,

          lockTtlMs:
            5 * MINUTE,

          task:
            async () => {
              await queueService
                .distributeOrders();
            }
        });
      }
    );

    /*
     * Intigo :
     * seconde 30 toutes les 5 minutes.
     *
     * Cela décale volontairement le job
     * par rapport au cron IA.
     */
    cron.schedule(
      '30 */5 * * * *',
      async () => {
        await executeScheduledJob({
          name:
            'intigo-status-sync',

          jobKey:
            'confirmed:jobs:intigo-status-sync',

          windowMs:
            5 * MINUTE,

          lockTtlMs:
            10 * MINUTE,

          task:
            async () => {
              const result =
                await runIntigoStatusSyncBatch({
                  limit: 25
                });

              logger.info(
                'Intigo automatic status sync completed',
                result.summary
              );
            }
        });
      }
    );

    /*
     * Nettoyage quotidien.
     */
    cron.schedule(
      '0 0 * * *',
      async () => {
        await executeScheduledJob({
          name:
            'log-cleanup',

          jobKey:
            'confirmed:jobs:log-cleanup',

          windowMs:
            24 * 60 * MINUTE,

          lockTtlMs:
            60 * MINUTE,

          task:
            async () => {
              logger.info(
                'Cleaning up old logs'
              );

              // TODO cleanup
            }
        });
      }
    );

    logger.info(
      'Background schedules registered',
      {
        instance:
          process.env.NODE_APP_INSTANCE ??
          null,

        protection:
          'redis-tick-deduplication'
      }
    );
  }
}

module.exports =
  new BackgroundJobs();
