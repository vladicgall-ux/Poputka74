/** Настоящее имя и фамилия, если пользователь их указал, иначе — имя из Telegram-профиля. */
export function displayName(fullName: string | null | undefined, firstName: string): string {
  return fullName || firstName;
}
