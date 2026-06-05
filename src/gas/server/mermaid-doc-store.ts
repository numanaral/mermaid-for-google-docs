/** Stores oversized encoded mermaid source in DocumentProperties (no extra OAuth scope). */

export const MERMAID_DOCSTORE_ALT_PREFIX = "docstore:";

const CHUNK_CHARS = 8000;
const KEY_PREFIX = "mermaid-src-";

const chunkCountKey = (id: string): string => `${KEY_PREFIX}${id}-n`;

const chunkKey = (id: string, index: number): string =>
  `${KEY_PREFIX}${id}-${index}`;

export const storeEncodedMermaidInDocument = (
  encoded: string,
): string | null => {
  try {
    const props = PropertiesService.getDocumentProperties();
    const id = Utilities.getUuid().replace(/-/g, "").slice(0, 12);
    const n = Math.ceil(encoded.length / CHUNK_CHARS);
    props.setProperty(chunkCountKey(id), String(n));
    for (let i = 0; i < n; i++) {
      const start = i * CHUNK_CHARS;
      props.setProperty(
        chunkKey(id, i),
        encoded.slice(start, start + CHUNK_CHARS),
      );
    }
    return id;
  } catch {
    return null;
  }
};

export const loadEncodedMermaidFromDocument = (id: string): string | null => {
  try {
    const props = PropertiesService.getDocumentProperties();
    const nRaw = props.getProperty(chunkCountKey(id));
    const n = parseInt(nRaw ?? "", 10);
    if (!n || n < 1) return null;
    let encoded = "";
    for (let i = 0; i < n; i++) {
      const part = props.getProperty(chunkKey(id, i));
      if (part === null) return null;
      encoded += part;
    }
    return encoded;
  } catch {
    return null;
  }
};

export const isDocstoreAltPointer = (altDescription: string): boolean =>
  altDescription.startsWith(MERMAID_DOCSTORE_ALT_PREFIX);

export const docstoreIdFromAlt = (altDescription: string): string | null => {
  if (!isDocstoreAltPointer(altDescription)) return null;
  const id = altDescription.slice(MERMAID_DOCSTORE_ALT_PREFIX.length).trim();
  return id.length > 0 ? id : null;
};
