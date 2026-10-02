// The pane's pictures, as SVG source for the `Svg` element. Pure: no engine
// calls, so each can be drawn in a browser on its own while working on it.

import { moonAge, ORDER, sunAltitude, type PrayerName } from './times'

const FONT = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n = (v: number) => Math.round(v * 10) / 10

type RGB = [number, number, number]
const rgb = (hex: string): RGB => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as RGB
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [rgb(a), rgb(b)]
  return `rgb(${x.map((v, i) => Math.round(v + ((y[i] ?? v) - v) * t)).join(',')})`
}

// The sky's top and horizon colours by the sun's altitude: night, the blue
// hour, the pink and orange of twilight, golden hour, day.
const SKY: Array<[number, string, string]> = [
  [-18, '#060a1c', '#0e1734'],
  [-12, '#0a1230', '#1f2a58'],
  [-6, '#172150', '#5b4378'],
  [-2, '#28376c', '#c56a78'],
  [0, '#38548f', '#ec9466'],
  [4, '#4673b3', '#f2b985'],
  [10, '#4b8bd3', '#a7d0f0'],
  [90, '#3a82d6', '#9ccdf4'],
]

const skyAt = (alt: number) => {
  const a = Math.max(-18, Math.min(90, alt))
  for (let i = 1; i < SKY.length; i++) {
    const [hi, top, low] = SKY[i]!
    const [lo, top0, low0] = SKY[i - 1]!
    if (a <= hi) {
      const t = (a - lo) / (hi - lo)
      return { top: mix(top0, top, t), horizon: mix(low0, low, t) }
    }
  }
  return { top: SKY[SKY.length - 1]![1], horizon: SKY[SKY.length - 1]![2] }
}

// A small deterministic generator, so the stars stay put from one redraw to the next.
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

// The lit part of the moon `age` days after new, as a path: the limb on the lit
// side and the terminator, an ellipse, back. Waxing is lit on the right.
const moonPath = (cx: number, cy: number, r: number, age: number) => {
  const phase = age / 29.530588853
  const k = Math.cos(2 * Math.PI * phase)
  const rx = n(Math.abs(k) * r)
  const waxing = phase < 0.5
  const limb = waxing ? 1 : 0
  const terminator = waxing ? (k > 0 ? 0 : 1) : k > 0 ? 1 : 0
  return `M${cx} ${cy - r} A${r} ${r} 0 0 ${limb} ${cx} ${cy + r} A${rx} ${r} 0 0 ${terminator} ${cx} ${cy - r}Z`
}

export type HeroArgs = {
  // Local midnight of the day drawn.
  day: Date
  // Where the sun is marked: today only.
  now: Date | null
  latitude: number
  longitude: number
  times: Record<PrayerName, Date>
  labels: Record<PrayerName, string>
  clocks: Record<PrayerName, string>
  next: PrayerName | null
  eyebrow: string
  heading: string
  detail: string
  // Elapsed share of the wait for the next prayer, 0 to 1; null draws no bar.
  progress: number | null
  pill: string | null
}

const W = 400
const H = 236
const HORIZON = 182
const LEFT = 14
const RIGHT = W - 14

// The day's sky: the sun's real path across it, each prayer where the sun stands
// at its time, and the sun (or the moon) now.
export const hero = (a: HeroArgs) => {
  const start = a.day.getTime()
  const x = (t: number) => LEFT + ((t - start) / 86400000) * (RIGHT - LEFT)
  const samples = Array.from({ length: 121 }, (_, i) => {
    const t = start + i * 12 * 60000
    return { t, alt: sunAltitude(new Date(t), a.latitude, a.longitude) }
  })
  const peak = Math.max(5, ...samples.map(s => s.alt))
  const up = 74 / peak
  const down = Math.min(up, 2.1)
  const y = (alt: number) => (alt >= 0 ? HORIZON - alt * up : HORIZON - alt * down)
  const line = (points: Array<{ t: number; alt: number }>) =>
    points.map((p, i) => `${i ? 'L' : 'M'}${n(x(p.t))} ${n(y(p.alt))}`).join('')

  const nowAlt = a.now ? sunAltitude(a.now, a.latitude, a.longitude) : 35
  const sky = skyAt(nowAlt)
  const dark = Math.max(0, Math.min(1, (-nowAlt - 3) / 9))

  const random = seeded(Math.floor(start / 86400000))
  const stars = dark
    ? Array.from({ length: 34 }, (_, i) => {
        const sx = n(8 + random() * (W - 16))
        const sy = n(6 + random() * (HORIZON - 30))
        const r = n(0.5 + random() * 0.9)
        const o = n((0.35 + random() * 0.6) * dark)
        const twinkle =
          i % 3 === 0
            ? `<animate attributeName="opacity" values="${o};${n(o * 0.25)};${o}" dur="${n(2.5 + random() * 3)}s" begin="${n(random() * 3)}s" repeatCount="indefinite"/>`
            : ''
        return `<circle cx="${sx}" cy="${sy}" r="${r}" fill="#fff" opacity="${o}">${twinkle}</circle>`
      }).join('')
    : ''

  const moon =
    a.now && dark > 0.2
      ? `<g opacity="${n(0.35 + 0.65 * dark)}"><circle cx="356" cy="70" r="20" fill="url(#moonGlow)"/><circle cx="356" cy="70" r="12" fill="#fff" opacity=".09"/><path d="${moonPath(356, 70, 12, moonAge(a.now))}" fill="#f3efe2"/></g>`
      : ''

  const past = a.now ? samples.filter(s => s.t <= a.now!.getTime()) : []
  const passed = a.now ? line([...past, { t: a.now.getTime(), alt: nowAlt }]) : ''

  const markers = ORDER.map(name => {
    const at = a.times[name].getTime()
    const mx = n(x(at))
    const my = n(y(sunAltitude(a.times[name], a.latitude, a.longitude)))
    const lx = n(Math.max(36, Math.min(W - 36, mx)))
    const isNext = name === a.next
    const dot =
      name === 'Sunrise'
        ? `<circle class="dot" cx="${mx}" cy="${my}" r="3.2" fill="none" stroke="#fff" stroke-width="1.6"/>`
        : `<circle class="dot" cx="${mx}" cy="${my}" r="${isNext ? 4.6 : 3.4}" fill="#fff"/>`
    const ring = isNext
      ? `<circle cx="${mx}" cy="${my}" r="7" fill="none" stroke="#fff" stroke-width="1.4" opacity=".7"><animate attributeName="r" values="6;10;6" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;0;.8" dur="2.4s" repeatCount="indefinite"/></circle>`
      : ''
    return `<g class="m${isNext ? ' next' : ''}"><title>${esc(a.labels[name])} · ${esc(a.clocks[name])}</title><circle cx="${mx}" cy="${my}" r="11" fill="transparent"/>${ring}${dot}<text class="lbl" x="${lx}" y="${n(my - 11)}" text-anchor="middle">${esc(a.labels[name])} ${esc(a.clocks[name])}</text></g>`
  }).join('')

  // The sun now; below the horizon it is often below the card too, so a tick on
  // the horizon says where in the day it is.
  const nx = a.now ? n(x(a.now.getTime())) : 0
  const sunMark = a.now
    ? nowAlt > -2
      ? `<g><circle cx="${nx}" cy="${n(y(nowAlt))}" r="24" fill="url(#sunGlow)"><animate attributeName="r" values="21;27;21" dur="4s" repeatCount="indefinite"/></circle><circle cx="${nx}" cy="${n(y(nowAlt))}" r="7.5" fill="#fff5cf"/></g>`
      : `<g><title>Now: the sun is ${Math.round(-nowAlt)}° below the horizon</title><path d="M${nx} ${HORIZON}V${H - 20}" stroke="#fff" stroke-opacity=".45" stroke-width="1.2" stroke-dasharray="2 3"/><circle cx="${nx}" cy="${HORIZON}" r="3.6" fill="#fff"/><text x="${nx}" y="${HORIZON - 8}" text-anchor="middle" class="now">now</text>${
          y(nowAlt) < H - 4
            ? `<circle cx="${nx}" cy="${n(y(nowAlt))}" r="4.5" fill="${sky.top}" stroke="#fff" stroke-width="1.6" opacity=".9"/>`
            : ''
        }</g>`
    : ''

  const hours = [6, 12, 18]
    .map(h => {
      const t = new Date(a.day.getFullYear(), a.day.getMonth(), a.day.getDate(), h).getTime()
      const text = h === 12 ? 'noon' : h < 12 ? `${h} am` : `${h - 12} pm`
      return `<text x="${n(x(t))}" y="${H - 8}" text-anchor="middle" class="hour">${text}</text>`
    })
    .join('')

  const bar =
    a.progress === null
      ? ''
      : `<rect x="20" y="100" width="130" height="3" rx="1.5" fill="#fff" opacity=".22"/><rect x="20" y="100" width="${n(130 * Math.max(0.02, Math.min(1, a.progress)))}" height="3" rx="1.5" fill="#fff" opacity=".9"/>`

  const pillWidth = a.pill ? Math.round(a.pill.length * 6.1 + 20) : 0
  const pill = a.pill
    ? `<g><rect x="${W - 14 - pillWidth}" y="16" width="${pillWidth}" height="22" rx="11" fill="#000" opacity=".22"/><text x="${W - 14 - pillWidth / 2}" y="31" text-anchor="middle" class="pill">${esc(a.pill)}</text></g>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky.top}"/><stop offset="${n(HORIZON / H)}" stop-color="${sky.horizon}"/><stop offset="1" stop-color="${sky.horizon}"/></linearGradient>
<radialGradient id="sunGlow"><stop offset="0" stop-color="#fff3c4" stop-opacity=".95"/><stop offset=".45" stop-color="#ffd27a" stop-opacity=".45"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
<radialGradient id="moonGlow"><stop offset=".5" stop-color="#f3efe2" stop-opacity=".18"/><stop offset="1" stop-color="#f3efe2" stop-opacity="0"/></radialGradient>
<clipPath id="card"><rect width="${W}" height="${H}" rx="14"/></clipPath>
</defs>
<style>
text{font-family:${FONT};fill:#fff}
.eyebrow{font-size:10.5px;font-weight:600;letter-spacing:1.3px;opacity:.75}
.big{font-size:31px;font-weight:650;letter-spacing:-.4px}
.detail{font-size:13.5px;opacity:.92}
.pill{font-size:11px;font-weight:600}
.hour{font-size:9px;opacity:.5}
.now{font-size:9.5px;font-weight:600;opacity:.8}
.lbl{font-size:10.5px;font-weight:600;opacity:0;transition:opacity .15s;paint-order:stroke;stroke:rgba(0,0,0,.35);stroke-width:3px}
.m:hover .lbl,.m.next .lbl{opacity:1}
.m .dot{transition:transform .15s;transform-box:fill-box;transform-origin:center}
.m:hover .dot{transform:scale(1.7)}
.m{cursor:default}
</style>
<g clip-path="url(#card)">
<rect width="${W}" height="${H}" fill="url(#sky)"/>
${stars}${moon}
<rect y="${HORIZON}" width="${W}" height="${H - HORIZON}" fill="#000" opacity=".24"/>
<line x1="0" y1="${HORIZON}" x2="${W}" y2="${HORIZON}" stroke="#fff" stroke-opacity=".35" stroke-width="1"/>
<path d="${line(samples)}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.6" stroke-dasharray="3 4"/>
${passed ? `<path d="${passed}" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="2.2" stroke-linecap="round"/>` : ''}
${hours}${markers}${sunMark}
<text x="20" y="32" class="eyebrow">${esc(a.eyebrow.toUpperCase())}</text>
<text x="19" y="65" class="big">${esc(a.heading)}</text>
<text x="20" y="88" class="detail">${esc(a.detail)}</text>
${bar}${pill}
</g>
</svg>`
}

// One small pictogram per time, in the colour of that part of the day. Asr is a
// stick and its shadow, since Asr begins when the shadow matches the stick.
const ICONS: Record<PrayerName, (c: string) => string> = {
  Fajr: c =>
    `<path d="M3 17h18" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/><path d="M6 17a6 6 0 0 1 12 0" fill="none" stroke="${c}" stroke-width="1.8" stroke-dasharray="2 2.2"/><path d="M18 3.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" fill="${c}"/>`,
  Sunrise: c =>
    `<path d="M3 18h18" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/><path d="M7 18a5 5 0 0 1 10 0z" fill="${c}"/><path d="M12 4v4M9.5 6.5L12 4l2.5 2.5M4.5 12.5l1.6 1M19.5 12.5l-1.6 1" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  Dhuhr: c =>
    `<circle cx="12" cy="12" r="4.4" fill="${c}"/><g stroke="${c}" stroke-width="1.7" stroke-linecap="round">${[0, 45, 90, 135, 180, 225, 270, 315]
      .map(r => `<path d="M12 3.2v2.2" transform="rotate(${r} 12 12)"/>`)
      .join('')}</g>`,
  Asr: c =>
    `<circle cx="17.5" cy="6.5" r="3.4" fill="${c}"/><path d="M6.5 20V11" stroke="${c}" stroke-width="2" stroke-linecap="round"/><path d="M6.5 20h10" stroke="${c}" stroke-width="2" stroke-linecap="round" opacity=".45"/>`,
  Maghrib: c =>
    `<path d="M3 18h18" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/><path d="M7 18a5 5 0 0 1 10 0z" fill="${c}"/><path d="M12 3.5v4.5M9.5 5.5L12 8l2.5-2.5" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  Isha: c =>
    `<path d="M15.5 4.2a8 8 0 1 0 4.3 12.6A6.5 6.5 0 0 1 15.5 4.2z" fill="${c}"/><path d="M18.5 3.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="${c}"/>`,
}

const ICON_COLOURS: Record<PrayerName, string> = {
  Fajr: '#8f9cf7',
  Sunrise: '#f5a54a',
  Dhuhr: '#f2bd2c',
  Asr: '#ea9a35',
  Maghrib: '#ee6f4a',
  Isha: '#9aa6ff',
}

export const icon = (name: PrayerName, dim: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g opacity="${dim ? 0.4 : 1}">${ICONS[name](ICON_COLOURS[name])}</g></svg>`

export type WeekDay = { letter: string; count: number; isToday: boolean; title: string }

// Seven rings, one a day, each filling as that day's five prayers are marked.
export const week = (days: WeekDay[]) => {
  const w = 44
  const r = 13
  const c = 2 * Math.PI * r
  const rings = days
    .map((d, i) => {
      const cx = i * w + w / 2
      const share = Math.min(1, d.count / 5)
      const full = d.count >= 5
      const arc =
        share > 0
          ? `<circle cx="${cx}" cy="20" r="${r}" fill="none" stroke="#34c27a" stroke-width="4" stroke-linecap="round" stroke-dasharray="${n(c * share)} ${n(c)}" transform="rotate(-90 ${cx} 20)"/>`
          : ''
      const inner = full
        ? `<path d="M${cx - 5} 20.5l3.4 3.2 6.2-7" fill="none" stroke="#34c27a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
        : d.count > 0
          ? `<text x="${cx}" y="24" text-anchor="middle" class="count">${d.count}</text>`
          : ''
      return `<g class="day"><title>${esc(d.title)}</title><circle cx="${cx}" cy="20" r="${r}" fill="none" stroke="#8a8f98" stroke-opacity=".28" stroke-width="4"/>${arc}${inner}<text x="${cx}" y="50" text-anchor="middle" class="letter${d.isToday ? ' today' : ''}">${esc(d.letter)}</text></g>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * days.length}" height="56" viewBox="0 0 ${w * days.length} 56"><style>text{font-family:${FONT};fill:#8a8f98}.count{font-size:11px;font-weight:600}.letter{font-size:10px;font-weight:600}.today{fill:#34c27a}.day{cursor:default}.day:hover circle:first-of-type{stroke-opacity:.5}</style>${rings}</svg>`
}

// A compass rose with the needle on the Qibla, the Kaaba at its tip.
export const compass = (bearing: number) => {
  const ticks = Array.from({ length: 12 }, (_, i) =>
    `<path d="M28 ${i % 3 === 0 ? 5 : 6.5}V${i % 3 === 0 ? 9.5 : 8.5}" stroke="#8a8f98" stroke-opacity="${i % 3 === 0 ? 0.8 : 0.45}" stroke-width="1.4" stroke-linecap="round" transform="rotate(${i * 30} 28 28)"/>`,
  ).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56"><title>Qibla ${Math.round(bearing)}° from north</title><circle cx="28" cy="28" r="25" fill="none" stroke="#8a8f98" stroke-opacity=".35" stroke-width="1.4"/>${ticks}<text x="28" y="19" text-anchor="middle" font-family="${FONT}" font-size="7.5" font-weight="700" fill="#8a8f98">N</text><g transform="rotate(${n(bearing)} 28 28)"><path d="M28 28L28 11" stroke="#34c27a" stroke-width="2.2" stroke-linecap="round"/><rect x="24.5" y="5.5" width="7" height="7" rx="1" fill="#1d1d1f" stroke="#d8b45a" stroke-width="1.2"/><path d="M24.5 8h7" stroke="#d8b45a" stroke-width="1"/></g><circle cx="28" cy="28" r="2.6" fill="#34c27a"/></svg>`
}
