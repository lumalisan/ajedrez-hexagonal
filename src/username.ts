export const USERNAME_MAX_LENGTH = 24;

export function validateUsername(value: string): string {
  const name = value.normalize('NFKC').trim();
  if (!name || name.length > USERNAME_MAX_LENGTH || /[\p{Cc}\p{Cf}]/u.test(name))
    throw new Error(
      'Elige un nombre de usuario de entre 1 y 24 caracteres, sin caracteres de control.',
    );
  return name;
}
