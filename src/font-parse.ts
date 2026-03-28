/**
 * Binary font file parsing — reads internal font names from TTF, OTF, and WOFF files.
 */

/** Parse the name table from a buffer at the given offset, returning the family name (nameID 1) */
export function parseFontNameTable(buffer: ArrayBuffer, nameOffset: number): string | null {
  const view = new DataView(buffer);
  const count = view.getUint16(nameOffset + 2);
  const stringOffset = nameOffset + view.getUint16(nameOffset + 4);

  // First pass: prefer platformID 3 (Windows) or 0 (Unicode) with nameID 1
  for (let i = 0; i < count; i++) {
    const recordOffset = nameOffset + 6 + i * 12;
    const platformID = view.getUint16(recordOffset);
    const nameID = view.getUint16(recordOffset + 6);
    if (nameID !== 1) continue;
    if (platformID !== 0 && platformID !== 3) continue;

    const length = view.getUint16(recordOffset + 8);
    const offset = view.getUint16(recordOffset + 10);
    const bytes = new Uint8Array(buffer, stringOffset + offset, length);

    // Decode as UTF-16BE (platform 0 and 3 use UTF-16BE)
    let name = "";
    for (let j = 0; j < bytes.length; j += 2) {
      name += String.fromCharCode((bytes[j] << 8) | bytes[j + 1]);
    }
    if (name) return name;
  }

  // Fallback: any platformID with nameID 1
  for (let i = 0; i < count; i++) {
    const recordOffset = nameOffset + 6 + i * 12;
    const nameID = view.getUint16(recordOffset + 6);
    if (nameID !== 1) continue;

    const length = view.getUint16(recordOffset + 8);
    const offset = view.getUint16(recordOffset + 10);
    const bytes = new Uint8Array(buffer, stringOffset + offset, length);
    const name = new TextDecoder("utf-8").decode(bytes);
    if (name) return name;
  }

  return null;
}

/** Read internal font family name from a TTF or WOFF file's name table (pure JS, no dependencies) */
export async function readInternalFontName(fontPath: string): Promise<string | null> {
  try {
    const buffer = await Bun.file(fontPath).arrayBuffer();
    const view = new DataView(buffer);

    // Detect format from magic bytes
    const magic = String.fromCharCode(
      view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3),
    );

    if (magic === "wOFF") {
      // WOFF1 format: header is 44 bytes, then table directory
      const numTables = view.getUint16(12);
      // WOFF table directory entries are 20 bytes each (tag, offset, compLength, origLength, origChecksum)
      for (let i = 0; i < numTables; i++) {
        const entryOffset = 44 + i * 20;
        const tag = String.fromCharCode(
          view.getUint8(entryOffset), view.getUint8(entryOffset + 1),
          view.getUint8(entryOffset + 2), view.getUint8(entryOffset + 3),
        );
        if (tag === "name") {
          const tableOffset = view.getUint32(entryOffset + 4);
          const compLength = view.getUint32(entryOffset + 8);
          const origLength = view.getUint32(entryOffset + 12);

          let nameBuffer: ArrayBuffer;
          if (compLength === origLength) {
            // Uncompressed — read directly
            nameBuffer = buffer.slice(tableOffset, tableOffset + origLength);
          } else {
            // WOFF1 uses zlib compression — decompress via DecompressionStream
            const compressed = new Uint8Array(buffer, tableOffset, compLength);
            const ds = new DecompressionStream("deflate");
            const writer = ds.writable.getWriter();
            writer.write(compressed);
            writer.close();
            const reader = ds.readable.getReader();
            const chunks: Uint8Array[] = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
            const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0);
            const result = new Uint8Array(totalLen);
            let pos = 0;
            for (const chunk of chunks) {
              result.set(chunk, pos);
              pos += chunk.byteLength;
            }
            nameBuffer = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
          }
          return parseFontNameTable(nameBuffer, 0);
        }
      }
      return null;
    }

    // TTF/OTF format (magic: 0x00010000 or 'OTTO' or 'true')
    const numTables = view.getUint16(4);
    for (let i = 0; i < numTables; i++) {
      const tableOffset = 12 + i * 16;
      const tag = String.fromCharCode(
        view.getUint8(tableOffset), view.getUint8(tableOffset + 1),
        view.getUint8(tableOffset + 2), view.getUint8(tableOffset + 3),
      );
      if (tag === "name") {
        const nameOffset = view.getUint32(tableOffset + 8);
        return parseFontNameTable(buffer, nameOffset);
      }
    }

    return null;
  } catch {
    return null;
  }
}
