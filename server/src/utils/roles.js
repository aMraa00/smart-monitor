'use strict';

/**
 * The single source of truth for "who may do what".
 *
 * The role vocabulary is deliberately tiny and closed, and it lives here (not
 * in a middleware) so that the HTTP middleware, the service layer and the
 * Socket.IO layer can never drift apart.
 *
 *   admin   - full access: every device, account management, fleet operations
 *   manager - fleet operator: reads EVERY device and tunes settings/alerts, but
 *             can never create accounts, nor revoke/delete a station
 *   owner   - device owner: claims and manages their OWN stations
 *   viewer  - legacy read-only alias, treated like a restricted owner account
 *
 * A role is only ever read from the database (`authenticate` re-reads the user
 * on every request), never trusted from a client body or a JWT claim alone.
 */

/** Roles that bypass per-device ownership checks. */
const PRIVILEGED_ROLES = ['admin', 'manager'];

/** Roles allowed to perform destructive device actions (revoke / delete). */
const DESTRUCTIVE_ROLES = ['admin', 'owner'];

/** True when the account may read devices it does not own. */
function isPrivileged(user) {
  return Boolean(user) && PRIVILEGED_ROLES.includes(user.role);
}

/** True for full platform administrators (account management). */
function isAdmin(user) {
  return Boolean(user) && user.role === 'admin';
}

/** True when the account may revoke or delete a station. */
function canDestroyDevice(user) {
  return Boolean(user) && DESTRUCTIVE_ROLES.includes(user.role);
}

module.exports = {
  PRIVILEGED_ROLES,
  DESTRUCTIVE_ROLES,
  isPrivileged,
  isAdmin,
  canDestroyDevice,
};