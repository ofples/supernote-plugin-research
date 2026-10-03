import {fromByteArray, toByteArray} from 'base64-js';

// AI SDK captures these globals at module import time; install before importing it.
export function installBase64(runtime: Record<string, unknown>) {
  if (typeof runtime.atob !== 'function') {
    runtime.atob = (encoded: string) => {
      let normalized = encoded.replace(/[\t\n\f\r ]/g, '');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1 ||
          (normalized.includes('=') && normalized.length % 4 !== 0)) {
        throw new Error('Invalid base64 input.');
      }
      normalized = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      const bytes = toByteArray(normalized);
      const chunks: string[] = [];
      for (let i = 0; i < bytes.length; i += 4096) {
        chunks.push(String.fromCharCode(...bytes.subarray(i, i + 4096)));
      }
      return chunks.join('');
    };
  }
  if (typeof runtime.btoa !== 'function') {
    runtime.btoa = (binary: string) => {
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        const code = binary.charCodeAt(i);
        if (code > 255) {throw new Error('Invalid binary input.');}
        bytes[i] = code;
      }
      return fromByteArray(bytes);
    };
  }
}
