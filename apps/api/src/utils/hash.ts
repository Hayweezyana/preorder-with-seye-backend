import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function hashValue(value: string) {
  return bcrypt.hash(value, SALT_ROUNDS);
}

export async function compareValue(value: string, hash: string | null | undefined) {
  if (!hash) {
    return false;
  }
  return bcrypt.compare(value, hash);
}
