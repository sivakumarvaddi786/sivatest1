/**
 * Returns today's date (YYYY-MM-DD) in the given IANA timezone.
 * Falls back to UTC if timezone is invalid or not provided.
 *
 * Uses "en-CA" locale which natively formats as YYYY-MM-DD.
 */
export function getTodayForTimezone(timezone) {
  try {
    if (!timezone) throw new Error("no timezone");
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
