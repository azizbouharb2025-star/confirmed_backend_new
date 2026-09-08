const crypto =
  require('crypto');

const {
  getRedisClient
} = require('../config/redis');

const logger =
  require('./logger');

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const redisAvailable = () => {
  const redis =
    getRedisClient();

  return Boolean(
    redis &&
    redis.isOpen &&
    redis.isReady
  );
};

const runWithDistributedLock =
  async ({
    lockKey,
    ttlMs,
    jobName,
    task
  }) => {
    const redis =
      getRedisClient();

    /*
     * FAIL CLOSED :
     *
     * Si Redis est indisponible,
     * aucun worker n'exécute le job.
     *
     * On préfère rater temporairement un polling
     * plutôt que lancer 4 fois une opération métier.
     */
    if (
      !redis ||
      !redis.isOpen ||
      !redis.isReady
    ) {
      logger.warn(
        `Skipping background job ${jobName}: Redis unavailable`
      );

      return {
        acquired:
          false,

        executed:
          false,

        mode:
          'redis-unavailable-skip'
      };
    }

    const token =
      crypto.randomUUID();

    const acquired =
      await redis.set(
        lockKey,
        token,
        {
          NX:
            true,

          PX:
            ttlMs
        }
      );

    if (acquired !== 'OK') {
      return {
        acquired:
          false,

        executed:
          false,

        mode:
          'already-running'
      };
    }

    try {
      const result =
        await task();

      return {
        acquired:
          true,

        executed:
          true,

        mode:
          'redis-lock',

        result
      };
    } finally {
      try {
        await redis.eval(
          RELEASE_SCRIPT,
          {
            keys: [
              lockKey
            ],

            arguments: [
              token
            ]
          }
        );
      } catch (error) {
        logger.warn(
          `Failed to release lock ${lockKey}: ${error.message}`
        );
      }
    }
  };

const runScheduledJobOnce =
  async ({
    jobKey,
    windowMs,
    lockTtlMs,
    jobName,
    task
  }) => {
    const redis =
      getRedisClient();

    /*
     * Même politique fail-closed
     * pour le scheduler.
     */
    if (
      !redis ||
      !redis.isOpen ||
      !redis.isReady
    ) {
      logger.warn(
        `Skipping scheduled job ${jobName}: Redis unavailable`
      );

      return {
        acquired:
          false,

        executed:
          false,

        mode:
          'redis-unavailable-skip'
      };
    }

    const bucket =
      Math.floor(
        Date.now() /
        windowMs
      );

    const tickKey =
      `${jobKey}:tick:${bucket}`;

    const tickTtlMs =
      Math.max(
        windowMs * 2,
        60000
      );

    const tickToken =
      crypto.randomUUID();

    /*
     * Cette clé représente LE créneau.
     *
     * Elle reste en Redis après exécution :
     * un worker retardé ne peut donc jamais
     * rejouer le même créneau.
     */
    const tickAcquired =
      await redis.set(
        tickKey,
        tickToken,
        {
          NX:
            true,

          PX:
            tickTtlMs
        }
      );

    if (tickAcquired !== 'OK') {
      return {
        acquired:
          false,

        executed:
          false,

        mode:
          'duplicate-tick',

        bucket
      };
    }

    const execution =
      await runWithDistributedLock({
        lockKey:
          `${jobKey}:running`,

        ttlMs:
          lockTtlMs,

        jobName,

        task
      });

    return {
      ...execution,
      bucket
    };
  };

module.exports = {
  redisAvailable,
  runWithDistributedLock,
  runScheduledJobOnce
};
