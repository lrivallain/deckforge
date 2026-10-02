// Random URL-safe access tokens for the local editor.

import crypto from "node:crypto";

/**
 * Return a base64url token of `bytes` random bytes that never starts with "-",
 * so it can't be mistaken for an option when passed back through argv.
 */
export function generateToken(bytes = 18) {
  let token;
  do token = crypto.randomBytes(bytes).toString("base64url");
  while (token.startsWith("-"));
  return token;
}
