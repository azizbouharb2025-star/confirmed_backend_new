/**
 * Customer phone identity helpers.
 *
 * IMPORTANT:
 * This is NOT delivery-provider formatting.
 *
 * The original clientInfo.phone value remains untouched.
 * These helpers are only used to identify the same customer
 * across differently formatted phone numbers.
 */

const normalizeCustomerPhoneIdentity = value => {
  const raw =
    String(
      value == null ? '' : value
    ).trim();

  if (!raw) {
    return '';
  }

  let digits =
    raw.replace(/\D/g, '');

  if (!digits) {
    return '';
  }

  /*
   * Tunisia:
   *
   * +216 22 123 456
   * 21622123456
   * 00216 22 123 456
   *
   * all become:
   *
   * 22123456
   */
  if (
    digits.length === 13 &&
    digits.startsWith('00216')
  ) {
    digits =
      digits.slice(5);
  } else if (
    digits.length === 11 &&
    digits.startsWith('216')
  ) {
    digits =
      digits.slice(3);
  }

  /*
   * Obvious placeholder.
   *
   * Several historical/test orders currently contain
   * 00000000. They must NOT all become one customer.
   */
  if (/^0+$/.test(digits)) {
    return '';
  }

  /*
   * Keep other digit-only identities available as well.
   *
   * We deliberately do not enforce Tunisian prefixes here,
   * because Confirmed may receive other valid formats.
   */
  return digits;
};


/**
 * Escape one literal digit sequence for a Mongo RegExp
 * allowing common phone separators between digits.
 */
const buildFlexibleDigitsPattern = digits =>
  digits
    .split('')
    .map(
      digit =>
        `${digit}[\\s\\-\\.\\(\\)]*`
    )
    .join('');


/**
 * Build a regex capable of finding historical orders
 * whose stored phone represents the same identity.
 *
 * Example identity 22123456 matches:
 *
 * 22123456
 * 22 123 456
 * +21622123456
 * +216 22 123 456
 * 21622123456
 * 0021622123456
 */
const buildCustomerPhoneRegex = value => {
  const identity =
    normalizeCustomerPhoneIdentity(
      value
    );

  if (!identity) {
    return null;
  }

  const localPattern =
    buildFlexibleDigitsPattern(
      identity
    );

  /*
   * Eight digits correspond to the canonical local
   * Tunisian representation used by this identity helper.
   */
  if (identity.length === 8) {
    const countryPrefix =
      '(?:' +
      '\\+?[\\s\\-\\.\\(\\)]*' +
      '216[\\s\\-\\.\\(\\)]*' +
      '|' +
      '00[\\s\\-\\.\\(\\)]*' +
      '216[\\s\\-\\.\\(\\)]*' +
      ')?';

    return new RegExp(
      `^\\s*${countryPrefix}${localPattern}\\s*$`
    );
  }

  /*
   * Non-Tunisian / other identities:
   * normalize separators but do not invent a country-code
   * transformation.
   */
  return new RegExp(
    `^\\s*${localPattern}\\s*$`
  );
};


module.exports = {
  normalizeCustomerPhoneIdentity,
  buildCustomerPhoneRegex
};
