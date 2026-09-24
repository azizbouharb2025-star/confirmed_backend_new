const express = require('express');

const CarrierStatusConfig =
  require('../models/CarrierStatusConfig');

const carrierStatusConfigValidator =
  require('../services/carrierStatusConfigValidationService');

const {
  buildInitialCarrierStatusMappings
} =
  require('../services/carrierStatusDefaultConfigService');

const {
  auth,
  authorize
} = require('../middleware/auth');


const router = express.Router();


/*
 * Toutes les routes de ce fichier sont réservées
 * aux administrateurs CONFIRMED.
 */
router.use(
  auth,
  authorize('admin')
);


// ==========================================================
// INITIALIZE FIRST DRAFT
// ==========================================================

router.post(
  '/initialize',
  async (req, res, next) => {
    try {
      const existing =
        await CarrierStatusConfig
          .findOne({})
          .select({
            _id: 1,
            version: 1,
            status: 1
          })
          .lean();

      if (existing) {
        return res.status(409).json({
          error:
            'Carrier status configuration already initialized',

          existingVersion:
            existing.version,

          existingStatus:
            existing.status
        });
      }

      const config =
        new CarrierStatusConfig({
          version: 1,

          status:
            'draft',

          mappings:
            buildInitialCarrierStatusMappings(),

          notes:
            'Configuration initiale basée sur les mappings transporteurs existants.',

          createdBy:
            req.user._id,

          activatedBy:
            null,

          activatedAt:
            null,

          clonedFromVersion:
            null
        });

      await config.validate();

      const validation =
        carrierStatusConfigValidator
          .validateForActivation(
            config.toObject()
          );

      if (!validation.valid) {
        return res.status(400).json({
          error:
            'Initial carrier status configuration is invalid',

          details:
            validation.errors
        });
      }

      await config.save();

      return res.status(201).json({
        message:
          'Carrier status configuration V1 created as draft',

        config
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          error:
            'Carrier status configuration initialization conflict'
        });
      }

      if (
        error?.name ===
        'ValidationError'
      ) {
        return res.status(400).json({
          error:
            'Invalid initial carrier status configuration',

          details:
            Object.values(
              error.errors || {}
            ).map(
              item =>
                item.message
            )
        });
      }

      next(error);
    }
  }
);


// ==========================================================
// LIST CONFIGURATIONS
// ==========================================================

router.get(
  '/configs',
  async (req, res, next) => {
    try {
      const configs =
        await CarrierStatusConfig
          .find({})
          .select({
            version: 1,
            status: 1,
            notes: 1,
            createdBy: 1,
            activatedBy: 1,
            activatedAt: 1,
            clonedFromVersion: 1,
            createdAt: 1,
            updatedAt: 1
          })
          .sort({
            version: -1
          })
          .lean();

      return res.json({
        configs
      });
    } catch (error) {
      next(error);
    }
  }
);


// ==========================================================
// ACTIVE CONFIGURATION
// ==========================================================

router.get(
  '/active',
  async (req, res, next) => {
    try {
      const config =
        await CarrierStatusConfig
          .findOne({
            status: 'active'
          })
          .lean();

      return res.json({
        active:
          Boolean(config),

        config:
          config || null
      });
    } catch (error) {
      next(error);
    }
  }
);


// ==========================================================
// GET ONE VERSION
// ==========================================================

router.get(
  '/configs/:version',
  async (req, res, next) => {
    try {
      const version =
        Number(req.params.version);

      if (
        !Number.isInteger(version) ||
        version < 1
      ) {
        return res.status(400).json({
          error:
            'Invalid carrier status configuration version'
        });
      }

      const config =
        await CarrierStatusConfig
          .findOne({
            version
          })
          .lean();

      if (!config) {
        return res.status(404).json({
          error:
            'Carrier status configuration not found'
        });
      }

      return res.json({
        config
      });
    } catch (error) {
      next(error);
    }
  }
);


// ==========================================================
// UPDATE DRAFT
// ==========================================================

router.put(
  '/configs/:version',
  async (req, res, next) => {
    try {
      const version =
        Number(req.params.version);

      if (
        !Number.isInteger(version) ||
        version < 1
      ) {
        return res.status(400).json({
          error:
            'Invalid carrier status configuration version'
        });
      }

      const config =
        await CarrierStatusConfig.findOne({
          version
        });

      if (!config) {
        return res.status(404).json({
          error:
            'Carrier status configuration not found'
        });
      }

      if (config.status !== 'draft') {
        return res.status(409).json({
          error:
            'Only draft carrier status configurations can be edited'
        });
      }

      const allowedFields = [
        'mappings',
        'notes'
      ];

      const suppliedFields =
        Object.keys(
          req.body || {}
        );

      const forbiddenFields =
        suppliedFields.filter(
          field =>
            !allowedFields.includes(
              field
            )
        );

      if (
        forbiddenFields.length > 0
      ) {
        return res.status(400).json({
          error:
            'Unsupported carrier status configuration fields',

          fields:
            forbiddenFields
        });
      }

      if (
        suppliedFields.length === 0
      ) {
        return res.status(400).json({
          error:
            'No carrier status configuration fields supplied'
        });
      }

      for (
        const field of allowedFields
      ) {
        if (
          Object.prototype
            .hasOwnProperty.call(
              req.body,
              field
            )
        ) {
          config.set(
            field,
            req.body[field]
          );
        }
      }

      await config.validate();

      const validation =
        carrierStatusConfigValidator
          .validateForActivation(
            config.toObject()
          );

      if (!validation.valid) {
        return res.status(400).json({
          error:
            'Invalid carrier status configuration',

          details:
            validation.errors
        });
      }

      await config.save();

      return res.json({
        message:
          `Carrier status draft V${version} updated`,

        config
      });
    } catch (error) {
      if (
        error?.name ===
        'ValidationError'
      ) {
        return res.status(400).json({
          error:
            'Invalid carrier status configuration',

          details:
            Object.values(
              error.errors || {}
            ).map(
              item =>
                item.message
            )
        });
      }

      next(error);
    }
  }
);


// ==========================================================
// DELETE DRAFT
// ==========================================================

router.delete(
  '/configs/:version',
  async (req, res, next) => {
    try {
      const version =
        Number(req.params.version);

      if (
        !Number.isInteger(version) ||
        version < 1
      ) {
        return res.status(400).json({
          error:
            'Invalid carrier status configuration version'
        });
      }

      const config =
        await CarrierStatusConfig
          .findOne({
            version
          })
          .select({
            _id: 1,
            version: 1,
            status: 1
          })
          .lean();

      if (!config) {
        return res.status(404).json({
          error:
            'Carrier status configuration not found'
        });
      }

      if (
        config.status !== 'draft'
      ) {
        return res.status(409).json({
          error:
            'Only draft carrier status configurations can be deleted'
        });
      }

      const deletion =
        await CarrierStatusConfig
          .deleteOne({
            _id:
              config._id,

            status:
              'draft'
          });

      if (
        deletion.deletedCount !== 1
      ) {
        return res.status(409).json({
          error:
            'Carrier status configuration changed before deletion'
        });
      }

      return res.json({
        message:
          `Carrier status draft V${version} deleted`,

        version
      });
    } catch (error) {
      next(error);
    }
  }
);


// ==========================================================
// CLONE VERSION
// ==========================================================

router.post(
  '/configs/:version/clone',
  async (req, res, next) => {
    try {
      const sourceVersion =
        Number(req.params.version);

      if (
        !Number.isInteger(
          sourceVersion
        ) ||
        sourceVersion < 1
      ) {
        return res.status(400).json({
          error:
            'Invalid carrier status configuration version'
        });
      }

      const source =
        await CarrierStatusConfig
          .findOne({
            version:
              sourceVersion
          });

      if (!source) {
        return res.status(404).json({
          error:
            'Carrier status configuration not found'
        });
      }

      const latest =
        await CarrierStatusConfig
          .findOne({})
          .sort({
            version: -1
          })
          .select({
            version: 1
          })
          .lean();

      const newVersion =
        (latest?.version || 0) + 1;

      const cloneData =
        source.toObject({
          depopulate: true
        });

      delete cloneData._id;
      delete cloneData.__v;
      delete cloneData.version;
      delete cloneData.status;
      delete cloneData.createdBy;
      delete cloneData.activatedBy;
      delete cloneData.activatedAt;
      delete cloneData.clonedFromVersion;
      delete cloneData.createdAt;
      delete cloneData.updatedAt;

      const clone =
        new CarrierStatusConfig({
          ...cloneData,

          version:
            newVersion,

          status:
            'draft',

          createdBy:
            req.user._id,

          clonedFromVersion:
            sourceVersion,

          activatedBy:
            null,

          activatedAt:
            null
        });

      await clone.validate();

      const validation =
        carrierStatusConfigValidator
          .validateForActivation(
            clone.toObject()
          );

      if (!validation.valid) {
        return res.status(400).json({
          error:
            'Cannot clone invalid carrier status configuration',

          details:
            validation.errors
        });
      }

      await clone.save();

      return res.status(201).json({
        message:
          `Carrier status configuration V${newVersion} created as draft`,

        config:
          clone
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          error:
            'Carrier status version conflict. Please retry.'
        });
      }

      next(error);
    }
  }
);


// ==========================================================
// ACTIVATE DRAFT
// ==========================================================

router.post(
  '/configs/:version/activate',
  async (req, res, next) => {
    try {
      const version =
        Number(req.params.version);

      if (
        !Number.isInteger(version) ||
        version < 1
      ) {
        return res.status(400).json({
          error:
            'Invalid carrier status configuration version'
        });
      }

      const target =
        await CarrierStatusConfig
          .findOne({
            version
          });

      if (!target) {
        return res.status(404).json({
          error:
            'Carrier status configuration not found'
        });
      }

      if (
        target.status !== 'draft'
      ) {
        return res.status(409).json({
          error:
            'Only draft carrier status configurations can be activated'
        });
      }

      await target.validate();

      const validation =
        carrierStatusConfigValidator
          .validateForActivation(
            target.toObject()
          );

      if (!validation.valid) {
        return res.status(400).json({
          error:
            'Carrier status configuration cannot be activated',

          details:
            validation.errors
        });
      }

      const activeConfig =
        await CarrierStatusConfig
          .findOne({
            status: 'active'
          })
          .select({
            _id: 1,
            version: 1
          })
          .lean();

      const activatedAt =
        new Date();

      const activationUpdate = {
        $set: {
          status:
            'active',

          activatedBy:
            req.user._id,

          activatedAt
        }
      };


      /*
       * Première activation :
       * aucune ancienne version active.
       */
      if (!activeConfig) {
        const activated =
          await CarrierStatusConfig
            .findOneAndUpdate(
              {
                version,
                status: 'draft'
              },
              activationUpdate,
              {
                new: true,
                runValidators: true
              }
            );

        if (!activated) {
          return res.status(409).json({
            error:
              'Carrier status configuration activation conflict'
          });
        }

        return res.json({
          message:
            `Carrier status configuration V${version} activated`,

          previousVersion:
            null,

          config:
            activated
        });
      }


      /*
       * Remplacement :
       *
       * MongoDB tourne sans transaction multi-document.
       * On archive donc l'ancienne version, puis on active
       * la nouvelle. Si l'activation échoue, on restaure
       * automatiquement l'ancienne.
       */
      const archived =
        await CarrierStatusConfig
          .findOneAndUpdate(
            {
              _id:
                activeConfig._id,

              status:
                'active'
            },
            {
              $set: {
                status:
                  'archived'
              }
            },
            {
              new: true,
              runValidators: true
            }
          );

      if (!archived) {
        return res.status(409).json({
          error:
            'Active carrier status configuration changed during activation'
        });
      }

      let activated = null;

      try {
        activated =
          await CarrierStatusConfig
            .findOneAndUpdate(
              {
                version,
                status:
                  'draft'
              },
              activationUpdate,
              {
                new: true,
                runValidators: true
              }
            );

        if (!activated) {
          throw new Error(
            'TARGET_ACTIVATION_CONFLICT'
          );
        }
      } catch (activationError) {
        try {
          const restored =
            await CarrierStatusConfig
              .findOneAndUpdate(
                {
                  _id:
                    activeConfig._id,

                  status:
                    'archived'
                },
                {
                  $set: {
                    status:
                      'active'
                  }
                },
                {
                  new: true,
                  runValidators: true
                }
              );

          if (!restored) {
            const rollbackError =
              new Error(
                'CARRIER_STATUS_ACTIVATION_ROLLBACK_FAILED'
              );

            rollbackError.cause =
              activationError;

            throw rollbackError;
          }
        } catch (rollbackError) {
          rollbackError.activationError =
            activationError;

          throw rollbackError;
        }

        if (
          activationError.message ===
          'TARGET_ACTIVATION_CONFLICT'
        ) {
          return res.status(409).json({
            error:
              'Carrier status configuration activation conflict. Previous active version restored.',

            activeVersion:
              activeConfig.version
          });
        }

        throw activationError;
      }

      return res.json({
        message:
          `Carrier status configuration V${version} activated`,

        previousVersion:
          activeConfig.version,

        config:
          activated
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(409).json({
          error:
            'Another carrier status configuration became active first'
        });
      }

      if (
        error?.name ===
        'ValidationError'
      ) {
        return res.status(400).json({
          error:
            'Invalid carrier status configuration',

          details:
            Object.values(
              error.errors || {}
            ).map(
              item =>
                item.message
            )
        });
      }

      next(error);
    }
  }
);


module.exports = router;
