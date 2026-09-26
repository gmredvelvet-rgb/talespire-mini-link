export const MODULE_ID = "talespire-mini-link";

/** Human-readable title, used in notifications and log prefixes. */
export const MODULE_TITLE = "TaleSpire Foundry Bridge - Mini Links";

/**
 * Localize a key, substituting `data` into its `{placeholders}` when given.
 *
 * v14 merged the old `format()` into `localize(key, data)` and dropped
 * `format` from Localization entirely, while v13's `localize` ignores a
 * second argument and only `format` interpolates. Neither call works on both
 * generations, so the version decides — with a capability check behind it in
 * case `game.release` is not readable yet.
 *
 * @param {string} key
 * @param {object} [data]
 * @returns {string}
 */
export function localize(key, data) {
  if ( !data ) return game.i18n.localize(key);
  if ( (game.release?.generation ?? 13) >= 14 ) return game.i18n.localize(key, data);
  return (typeof game.i18n.format === "function")
    ? game.i18n.format(key, data)
    : game.i18n.localize(key, data);
}
