/**
 * Password hashing utilities using Argon2id.
 *
 * Security notes:
 *  - Argon2id is the recommended password hashing algorithm (OWASP, PHC).
 *  - Never store or log plaintext passwords.
 *  - The hash includes salt, parameters, and version, so verification is self-contained.
 *  - Parameters are tuned for reasonable security vs. performance on commodity hardware.
 */

import argon2 from 'argon2';

/**
 * Hash a plaintext password using Argon2id.
 *
 * Parameters follow OWASP recommendations for Argon2id:
 *  - m=65536 (64 MiB memory)
 *  - t=3 (iterations)
 *  - p=4 (parallelism)
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: 65_536, // 64 MiB
    timeCost: 3,
    parallelism: 4,
  });
}

/**
 * Verify a plaintext password against an Argon2id hash.
 * Returns true if the password matches, false otherwise.
 * Never throws on mismatch — only on malformed hash or internal error.
 */
export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    // Malformed hash or other error — treat as invalid password
    return false;
  }
}
