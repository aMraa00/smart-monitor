'use strict';

const express = require('express');
const controller = require('../controllers/device.controller');
const validate = require('../middleware/validate.middleware');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
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
// Destructive actions: owner of the device or admin. Managers are read/config
// operators and can never revoke or delete a station.
router.post('/:deviceId/revoke', requireRole('admin', 'owner'), loadOwnedDevice, controller.revoke);
router.delete('/:deviceId', requireRole('admin', 'owner'), loadOwnedDevice, controller.remove);

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
