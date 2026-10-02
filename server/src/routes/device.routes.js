'use strict';

const express = require('express');
const controller = require('../controllers/device.controller');
const validate = require('../middleware/validate.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const { loadOwnedDevice } = require('../middleware/ownership.middleware');
const {
  listQuerySchema,
  claimSchema,
  updateSchema,
  transferSchema,
} = require('../validators/device.validator');
const {
  createRuleSchema,
  updateRuleSchema,
  listAlertsQuerySchema,
} = require('../validators/alert.validator');
const { z } = require('zod');
const { objectId } = require('../validators/common');

const router = express.Router();

// Every device route requires an authenticated user.
router.use(authenticate);

router.get('/', validate({ query: listQuerySchema }), controller.list);
router.post('/claim', validate({ body: claimSchema }), controller.claim);

// Routes below operate on one device and are guarded by the ownership check.
router.get('/:deviceId', loadOwnedDevice, controller.getOne);
router.patch('/:deviceId', validate({ body: updateSchema }), loadOwnedDevice, controller.update);
router.post('/:deviceId/rotate-secret', loadOwnedDevice, controller.rotateSecret);
router.post('/:deviceId/transfer', validate({ body: transferSchema }), loadOwnedDevice, controller.transfer);
router.post('/:deviceId/revoke', loadOwnedDevice, controller.revoke);
router.delete('/:deviceId', loadOwnedDevice, controller.remove);

// Alerts
router.get('/:deviceId/alerts', validate({ query: listAlertsQuerySchema }), loadOwnedDevice, controller.listAlerts);
router.get('/:deviceId/alert-rules', loadOwnedDevice, controller.listRules);
router.post('/:deviceId/alert-rules', validate({ body: createRuleSchema }), loadOwnedDevice, controller.createRule);
router.patch(
  '/:deviceId/alert-rules/:ruleId',
  validate({ body: updateRuleSchema, params: z.object({ deviceId: z.string(), ruleId: objectId }) }),
  loadOwnedDevice,
  controller.updateRule
);
router.delete(
  '/:deviceId/alert-rules/:ruleId',
  validate({ params: z.object({ deviceId: z.string(), ruleId: objectId }) }),
  loadOwnedDevice,
  controller.deleteRule
);

module.exports = router;
