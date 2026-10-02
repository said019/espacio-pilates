// These fixed formats recur in Wallet, notifications and reporting. Reusing
// their ICU formatters avoids allocating a new native formatter per date.
// There are exactly five default-zone slots, not a cache keyed by caller data.
// Recreate those slots if TZ changes, as Date#toLocaleDateString does.
const defaultOptions = Object.freeze({
  date: undefined,
  dayMonth: { day: "numeric", month: "short" },
  dayMonthYear: { day: "numeric", month: "short", year: "numeric" },
  weekdayDayMonth: { weekday: "short", day: "numeric", month: "short" },
  weekdayDayMonthYear: { weekday: "short", day: "numeric", month: "short", year: "numeric" },
});
let defaultZone = process.env.TZ;
let defaultFormatters = Object.create(null);
const utcDate = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC" });
const mexicoCityTimestamp = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City", year: "numeric", month: "numeric", day: "numeric",
  hour: "numeric", minute: "numeric", second: "numeric",
});
const mexicoCityParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit",
});

export function formatEsMxDate(date, style = "date") {
  // Date#toLocaleDateString returned this string for invalid dates rather than
  // throwing RangeError, which Intl#format would otherwise do.
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  if (style === "utcDate") return utcDate.format(date);
  if (!Object.hasOwn(defaultOptions, style)) throw new RangeError("Unknown server date format");
  if (defaultZone !== process.env.TZ) {
    defaultZone = process.env.TZ;
    defaultFormatters = Object.create(null);
  }
  const formatter = defaultFormatters[style] ||= new Intl.DateTimeFormat("es-MX", defaultOptions[style]);
  return formatter.format(date);
}

export function formatMexicoCityTimestamp(date) {
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  return mexicoCityTimestamp.format(date);
}

export function mexicoCityDateParts(date) {
  return mexicoCityParts.formatToParts(date);
}
