// Prayer time calculation, after the PrayTimes.org method (Hamid Zarrabi-Zadeh,
// LGPL), rewritten in TypeScript. Pure: no engine calls, so it can be tested alone.

export type Method = 'ISNA' | 'MWL' | 'Egyptian' | 'UmmAlQura' | 'Karachi'
export type AsrMethod = 'Standard' | 'Hanafi'
export type PrayerName = 'Fajr' | 'Sunrise' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha'

// Fajr angle, and Isha as an angle or minutes after Maghrib.
const METHODS: Record<Method, { fajr: number; isha: { angle: number } | { minutes: number } }> = {
  ISNA: { fajr: 15, isha: { angle: 15 } },
  MWL: { fajr: 18, isha: { angle: 17 } },
  Egyptian: { fajr: 19.5, isha: { angle: 17.5 } },
  UmmAlQura: { fajr: 18.5, isha: { minutes: 90 } },
  Karachi: { fajr: 18, isha: { angle: 18 } },
}

export const METHOD_NAMES: Record<Method, string> = {
  ISNA: 'ISNA (15°/15°)',
  MWL: 'Muslim World League (18°/17°)',
  Egyptian: 'Egyptian (19.5°/17.5°)',
  UmmAlQura: 'Umm al-Qura (18.5°, Isha 90 min)',
  Karachi: 'Karachi (18°/18°)',
}

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
const fix = (a: number, b: number) => {
  const r = a - b * Math.floor(a / b)
  return r < 0 ? r + b : r
}
const fixAngle = (a: number) => fix(a, 360)
const fixHour = (a: number) => fix(a, 24)

const julian = (year: number, month: number, day: number) => {
  if (month <= 2) {
    year -= 1
    month += 12
  }
  const a = Math.floor(year / 100)
  const b = 2 - a + Math.floor(a / 4)
  return Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + b - 1524.5
}

// Declination and equation of time for a Julian date.
const sun = (jd: number) => {
  const d = jd - 2451545.0
  const g = fixAngle(357.529 + 0.98560028 * d)
  const q = fixAngle(280.459 + 0.98564736 * d)
  const l = fixAngle(q + 1.915 * Math.sin(rad(g)) + 0.02 * Math.sin(rad(2 * g)))
  const e = 23.439 - 0.00000036 * d
  const ra = deg(Math.atan2(Math.cos(rad(e)) * Math.sin(rad(l)), Math.cos(rad(l)))) / 15
  return { declination: deg(Math.asin(Math.sin(rad(e)) * Math.sin(rad(l)))), equation: q / 15 - fixHour(ra) }
}

export type Settings = { latitude: number; longitude: number; method: Method; asr: AsrMethod }

// The day's times as Dates, for the local calendar day of `day`.
export const prayerTimes = (day: Date, s: Settings): Record<PrayerName, Date> => {
  const y = day.getFullYear()
  const m = day.getMonth() + 1
  const d = day.getDate()
  const zone = -new Date(y, m - 1, d, 12).getTimezoneOffset() / 60
  const jd = julian(y, m, d) - s.longitude / (15 * 24)

  const midDay = (t: number) => fixHour(12 - sun(jd + t).equation)
  const angleTime = (angle: number, t: number, before: boolean) => {
    const { declination } = sun(jd + t)
    const noon = midDay(t)
    const cosH =
      (-Math.sin(rad(angle)) - Math.sin(rad(declination)) * Math.sin(rad(s.latitude))) /
      (Math.cos(rad(declination)) * Math.cos(rad(s.latitude)))
    const h = deg(Math.acos(Math.max(-1, Math.min(1, cosH)))) / 15
    return noon + (before ? -h : h)
  }
  const asrTime = (factor: number, t: number) => {
    const { declination } = sun(jd + t)
    const angle = -deg(Math.atan(1 / (factor + Math.tan(rad(Math.abs(s.latitude - declination))))))
    return angleTime(angle, t, false)
  }

  const method = METHODS[s.method]
  // Each pass evaluates the sun at the previous pass's times; three passes settle
  // to well under a second (one, from rough guesses, can leave Asr a minute out).
  const p = (hour: number) => hour / 24
  let hours = { Fajr: 5, Sunrise: 6, Dhuhr: 12, Asr: 13, Maghrib: 18, Isha: 18 }
  for (let pass = 0; pass < 3; pass++) {
    hours = {
      Fajr: angleTime(method.fajr, p(hours.Fajr), true),
      Sunrise: angleTime(0.833, p(hours.Sunrise), true),
      Dhuhr: midDay(p(hours.Dhuhr)),
      Asr: asrTime(s.asr === 'Hanafi' ? 2 : 1, p(hours.Asr)),
      Maghrib: angleTime(0.833, p(hours.Maghrib), false),
      Isha: 'angle' in method.isha ? angleTime(method.isha.angle, p(hours.Isha), false) : hours.Isha,
    }
  }
  if ('minutes' in method.isha) hours.Isha = hours.Maghrib + method.isha.minutes / 60

  const out = {} as Record<PrayerName, Date>
  for (const [name, hour] of Object.entries(hours) as Array<[PrayerName, number]>) {
    const local = hour + zone - s.longitude / 15
    // Nearest minute, as published timetables (aladhan.com among them) round.
    const minutes = Math.round(local * 60)
    out[name] = new Date(y, m - 1, d, 0, minutes)
  }
  return out
}

export const ORDER: PrayerName[] = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']
// Sunrise is shown, but it is the end of Fajr, not a prayer to announce.
export const PRAYERS: PrayerName[] = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']

// The next prayer after `now`: today's, or tomorrow's Fajr.
export const nextPrayer = (now: Date, s: Settings) => {
  const today = prayerTimes(now, s)
  for (const name of PRAYERS) if (today[name] > now) return { name, at: today[name] }
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return { name: 'Fajr' as PrayerName, at: prayerTimes(tomorrow, s).Fajr }
}

// The prayer whose time began within `windowMs` before `now`, if any.
export const currentPrayer = (now: Date, s: Settings, windowMs: number) => {
  const today = prayerTimes(now, s)
  for (const name of [...PRAYERS].reverse()) {
    const at = today[name]
    if (at <= now && now.getTime() - at.getTime() < windowMs) return { name, at }
  }
  return null
}

// Friday's Dhuhr is Jumu'ah.
export const label = (name: PrayerName, at: Date) => (name === 'Dhuhr' && at.getDay() === 5 ? "Jumu'ah" : name)

// A sensible starting point from the time zone alone, for anyone who has not set
// a location: the zone's main city, and the method most used there.
const ZONES: Record<string, { city: string; latitude: number; longitude: number; method: Method }> = {
  'America/New_York': { city: 'New York', latitude: 40.71, longitude: -74.01, method: 'ISNA' },
  'America/Detroit': { city: 'Detroit', latitude: 42.33, longitude: -83.05, method: 'ISNA' },
  'America/Toronto': { city: 'Toronto', latitude: 43.65, longitude: -79.38, method: 'ISNA' },
  'America/Chicago': { city: 'Chicago', latitude: 41.88, longitude: -87.63, method: 'ISNA' },
  'America/Denver': { city: 'Denver', latitude: 39.74, longitude: -104.99, method: 'ISNA' },
  'America/Phoenix': { city: 'Phoenix', latitude: 33.45, longitude: -112.07, method: 'ISNA' },
  'America/Los_Angeles': { city: 'Los Angeles', latitude: 34.05, longitude: -118.24, method: 'ISNA' },
  'America/Vancouver': { city: 'Vancouver', latitude: 49.28, longitude: -123.12, method: 'ISNA' },
  'America/Mexico_City': { city: 'Mexico City', latitude: 19.43, longitude: -99.13, method: 'MWL' },
  'America/Sao_Paulo': { city: 'São Paulo', latitude: -23.55, longitude: -46.63, method: 'MWL' },
  'Europe/London': { city: 'London', latitude: 51.51, longitude: -0.13, method: 'MWL' },
  'Europe/Dublin': { city: 'Dublin', latitude: 53.35, longitude: -6.26, method: 'MWL' },
  'Europe/Paris': { city: 'Paris', latitude: 48.86, longitude: 2.35, method: 'MWL' },
  'Europe/Berlin': { city: 'Berlin', latitude: 52.52, longitude: 13.41, method: 'MWL' },
  'Europe/Amsterdam': { city: 'Amsterdam', latitude: 52.37, longitude: 4.9, method: 'MWL' },
  'Europe/Brussels': { city: 'Brussels', latitude: 50.85, longitude: 4.35, method: 'MWL' },
  'Europe/Madrid': { city: 'Madrid', latitude: 40.42, longitude: -3.7, method: 'MWL' },
  'Europe/Rome': { city: 'Rome', latitude: 41.9, longitude: 12.5, method: 'MWL' },
  'Europe/Stockholm': { city: 'Stockholm', latitude: 59.33, longitude: 18.07, method: 'MWL' },
  'Europe/Istanbul': { city: 'Istanbul', latitude: 41.01, longitude: 28.98, method: 'MWL' },
  'Africa/Cairo': { city: 'Cairo', latitude: 30.04, longitude: 31.24, method: 'Egyptian' },
  'Africa/Casablanca': { city: 'Casablanca', latitude: 33.57, longitude: -7.59, method: 'MWL' },
  'Africa/Lagos': { city: 'Lagos', latitude: 6.52, longitude: 3.38, method: 'MWL' },
  'Africa/Nairobi': { city: 'Nairobi', latitude: -1.29, longitude: 36.82, method: 'MWL' },
  'Africa/Johannesburg': { city: 'Johannesburg', latitude: -26.2, longitude: 28.05, method: 'MWL' },
  'Asia/Riyadh': { city: 'Riyadh', latitude: 24.71, longitude: 46.68, method: 'UmmAlQura' },
  'Asia/Dubai': { city: 'Dubai', latitude: 25.2, longitude: 55.27, method: 'UmmAlQura' },
  'Asia/Qatar': { city: 'Doha', latitude: 25.29, longitude: 51.53, method: 'UmmAlQura' },
  'Asia/Kuwait': { city: 'Kuwait City', latitude: 29.38, longitude: 47.99, method: 'UmmAlQura' },
  'Asia/Amman': { city: 'Amman', latitude: 31.95, longitude: 35.93, method: 'MWL' },
  'Asia/Beirut': { city: 'Beirut', latitude: 33.89, longitude: 35.5, method: 'MWL' },
  'Asia/Baghdad': { city: 'Baghdad', latitude: 33.31, longitude: 44.36, method: 'MWL' },
  'Asia/Karachi': { city: 'Karachi', latitude: 24.86, longitude: 67.0, method: 'Karachi' },
  'Asia/Kolkata': { city: 'Delhi', latitude: 28.61, longitude: 77.21, method: 'Karachi' },
  'Asia/Dhaka': { city: 'Dhaka', latitude: 23.81, longitude: 90.41, method: 'Karachi' },
  'Asia/Jakarta': { city: 'Jakarta', latitude: -6.21, longitude: 106.85, method: 'MWL' },
  'Asia/Kuala_Lumpur': { city: 'Kuala Lumpur', latitude: 3.14, longitude: 101.69, method: 'MWL' },
  'Asia/Singapore': { city: 'Singapore', latitude: 1.35, longitude: 103.82, method: 'MWL' },
  'Australia/Sydney': { city: 'Sydney', latitude: -33.87, longitude: 151.21, method: 'MWL' },
  'Australia/Melbourne': { city: 'Melbourne', latitude: -37.81, longitude: 144.96, method: 'MWL' },
}

export const guessFromZone = (zone: string) => ZONES[zone] ?? { city: 'Mecca', latitude: 21.42, longitude: 39.83, method: 'UmmAlQura' as Method }

export const clock = (at: Date) => at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

// The sun's altitude above the horizon at `at`, in degrees: what the pane's sky
// is drawn from.
export const sunAltitude = (at: Date, latitude: number, longitude: number) => {
  const { declination, equation } = sun(at.getTime() / 86400000 + 2440587.5)
  const utc = at.getUTCHours() + at.getUTCMinutes() / 60 + at.getUTCSeconds() / 3600
  const solar = utc + longitude / 15 + (fix(equation + 12, 24) - 12)
  const hourAngle = (solar - 12) * 15
  const sinAlt =
    Math.sin(rad(latitude)) * Math.sin(rad(declination)) +
    Math.cos(rad(latitude)) * Math.cos(rad(declination)) * Math.cos(rad(hourAngle))
  return deg(Math.asin(Math.max(-1, Math.min(1, sinAlt))))
}

// Days since the last new moon, from a known one (2000-01-06 18:14 UTC); good to
// within a day, which is all a drawing of the moon needs.
export const moonAge = (at: Date) => fix(at.getTime() / 86400000 + 2440587.5 - 2451550.26, 29.530588853)

const KAABA = { latitude: 21.4225, longitude: 39.8262 }

// Bearing to the Kaaba from true north, clockwise, and the distance there.
export const qibla = (latitude: number, longitude: number) => {
  const φ = rad(latitude)
  const φk = rad(KAABA.latitude)
  const Δλ = rad(KAABA.longitude - longitude)
  const bearing = fixAngle(deg(Math.atan2(Math.sin(Δλ), Math.cos(φ) * Math.tan(φk) - Math.sin(φ) * Math.cos(Δλ))))
  const a = Math.sin((φk - φ) / 2) ** 2 + Math.cos(φ) * Math.cos(φk) * Math.sin(Δλ / 2) ** 2
  return { bearing, km: 2 * 6371 * Math.asin(Math.sqrt(a)) }
}

export const compassPoint = (bearing: number) =>
  ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(fixAngle(bearing) / 45) % 8]

// Places the location field knows by name, beyond the time zones' cities.
const PLACES: Record<string, { latitude: number; longitude: number }> = {
  ...Object.fromEntries(Object.values(ZONES).map(z => [z.city, { latitude: z.latitude, longitude: z.longitude }])),
  'Washington DC': { latitude: 38.91, longitude: -77.04 },
  'Northern Virginia': { latitude: 38.85, longitude: -77.31 },
  Baltimore: { latitude: 39.29, longitude: -76.61 },
  Philadelphia: { latitude: 39.95, longitude: -75.17 },
  Boston: { latitude: 42.36, longitude: -71.06 },
  Atlanta: { latitude: 33.75, longitude: -84.39 },
  Houston: { latitude: 29.76, longitude: -95.37 },
  Dallas: { latitude: 32.78, longitude: -96.8 },
  Minneapolis: { latitude: 44.98, longitude: -93.27 },
  'San Francisco': { latitude: 37.77, longitude: -122.42 },
  Seattle: { latitude: 47.61, longitude: -122.33 },
  Montreal: { latitude: 45.5, longitude: -73.57 },
  Birmingham: { latitude: 52.49, longitude: -1.89 },
  Manchester: { latitude: 53.48, longitude: -2.24 },
  Makkah: { latitude: 21.42, longitude: 39.83 },
  Medina: { latitude: 24.47, longitude: 39.61 },
  Jeddah: { latitude: 21.49, longitude: 39.19 },
  Jerusalem: { latitude: 31.78, longitude: 35.22 },
  Alexandria: { latitude: 31.2, longitude: 29.92 },
  Khartoum: { latitude: 15.5, longitude: 32.56 },
  Lahore: { latitude: 31.55, longitude: 74.34 },
  Islamabad: { latitude: 33.68, longitude: 73.05 },
  'Abu Dhabi': { latitude: 24.45, longitude: 54.38 },
}

// What the location field accepts: "38.85, -77.31", "38.85, -77.31 Fairfax", or
// a place it knows by name. Null when it cannot tell.
export const parseLocation = (text: string) => {
  const input = text.trim()
  const coords = input.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*,?\s*(.*)$/)
  if (coords) {
    const latitude = Number(coords[1])
    const longitude = Number(coords[2])
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
    return { latitude, longitude, place: coords[3]?.trim() || `${latitude.toFixed(2)}, ${longitude.toFixed(2)}` }
  }
  const wanted = input.toLowerCase()
  if (!wanted) return null
  const names = Object.keys(PLACES)
  const name =
    names.find(n => n.toLowerCase() === wanted) ??
    names.find(n => n.toLowerCase().startsWith(wanted)) ??
    names.find(n => n.toLowerCase().includes(wanted))
  return name ? { ...PLACES[name]!, place: name } : null
}
