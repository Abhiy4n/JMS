export function userFacingError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;

  const message = error.message.trim();
  if (
    /<!doctype html|<html\b|traceback|programmingerror at|exception type:/i.test(message)
  ) {
    return fallback;
  }

  return message || fallback;
}