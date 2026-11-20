export function encodeWindows1251(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) bytes.push(code);
    else if (code >= 0x0410 && code <= 0x044f) bytes.push(code - 0x0410 + 0xc0);
    else if (code === 0x0401) bytes.push(0xa8);
    else if (code === 0x0451) bytes.push(0xb8);
    else bytes.push(0x3f);
  }
  return new Uint8Array(bytes);
}
