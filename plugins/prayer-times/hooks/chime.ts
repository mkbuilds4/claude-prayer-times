// A soft two-note bell, synthesized as a 16-bit mono WAV: no sound file ships
// with the plugin, so there is nothing to license.

const RATE = 22050

const note = (out: Float32Array, start: number, freq: number, length: number, gain: number) => {
  for (let i = 0; i < length && start + i < out.length; i++) {
    const t = i / RATE
    // A bell: the fundamental plus two quiet partials, fading out.
    const envelope = Math.exp(-3.2 * t) * Math.min(1, t * 200)
    const sample =
      Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(2 * Math.PI * freq * 2.76 * t) + 0.12 * Math.sin(2 * Math.PI * freq * 5.4 * t)
    out[start + i] = (out[start + i] ?? 0) + sample * envelope * gain
  }
}

export const chimeWav = (): Uint8Array => {
  const total = Math.floor(RATE * 2.4)
  const pcm = new Float32Array(total)
  note(pcm, 0, 659.25, total, 0.22) // E5
  note(pcm, Math.floor(RATE * 0.45), 987.77, total, 0.18) // B5
  const bytes = new Uint8Array(44 + total * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + total * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, RATE, true)
  view.setUint32(28, RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, total * 2, true)
  for (let i = 0; i < total; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i] ?? 0)) * 32767, true)
  return bytes
}

export const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
