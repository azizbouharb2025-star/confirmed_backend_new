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

const isPrimaryProcess = () => {
  const instance =
    process.env.NODE_APP_INSTANCE;

  if (
    instance === undefined ||
    instance === null ||
    instance === ''
  ) {
    return true;
  }

  return String(instance) === '0';
};

/*
 * Verrou d'exécution.
 *
 * Empêche deux créneaux différents
 * d'exécuter simultanément le même job
 * si le précédent est encore actif.
 */
const runWithDistributedLock =
  async ({
    lockKey,
    ttlMs,
    jobName,
    task
  }) => {
    const redis =
      getRedisClient();

    if (
      !redis ||
      !redis.isOpen ||
      !redis.isReady
    ) {
      if (!isPrimaryProcess()) {
        return {
          acquired: false,
          executed: false,
          mode: 'primary-fallback-skip'
        };
      }

      logger.warn(
        `Redis unavailable for ${jobName}; ` +
        'primary PM2 fallback used'
      );

      const result =
        await task();

      return {
        acquired: true,
        executed: true,
        mode: 'primary-fallback',
        result
      };
    }

    const token =
      crypto.randomUUID();

    const acquired =
      await redis.set(
        lockKey,
        token,
        {
          NX: true,
          PX: ttlMs
        }
      );

    if (acquired !== 'OK') {
      return {
        acquired: false,
        executed: false,
        mode: 'already-running'
      };
    }

    try {
      const result =
        await task();

      return {
        acquired: true,
        executed: true,
        mode: 'redis-lock',
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
          `Failed to release lock ${lockKey}: ` +
          error.message
        );
      }
    }
  };

/*
 * Protection cron complète.
 *
 * 1. tickKey :
 *    un seul worker gagne pour ce créneau.
 *    La clé n'est PAS supprimée à la fin.
 *
 * 2. runningKey :
 *    empêche le nouveau créneau de démarrer
 *    si l'ancien traitement est encore actif.
 */
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

    if (
      !redis ||
      !redis.isOpen ||
      !redis.isReady
    ) {
      if (!isPrimaryProcess()) {
        return {
          acquired: false,
          executed: false,
          mode: 'primary-fallback-skip'
        };
      }

      logger.warn(
        `Redis unavailable for ${jobName}; ` +
        'primary PM2 fallback used'
      );

      const result =
        await task();

      return {
        acquired: true,
        executed: true,
        mode: 'primary-fallback',
        result
      };
    }

    const bucket =
      Math.floor(
        Date.now() /
        windowMs
      );

    const tickKey =
      `${jobKey}:tick:${bucket}`;

    /*
     * Le tick reste présent suffisamment longtemps
     * pour qu'un worker retardé ne puisse jamais
     * relancer le même créneau.
     */
    const tickTtlMs =
      Math.max(
        windowMs * 2,
        60000
      );

    const tickToken =
      crypto.randomUUID();

    const tickAcquired =
      await redis.set(
        tickKey,
        tickToken,
        {
          NX: true,
          PX: tickTtlMs
        }
      );

    if (tickAcquired !== 'OK') {
      return {
        acquired: false,
        executed: false,
        mode: 'duplicate-tick',
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
  runWithDistributedLock,
  runScheduledJobOnce,
  isPrimaryProcess
};
