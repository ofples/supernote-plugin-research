import {ReadableStream, WritableStream, TransformStream} from 'web-streams-polyfill';
import 'fast-text-encoding';
import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import {installBase64} from './base64';
// AI SDK modules define stream classes during import even for non-streaming requests.
const runtime = globalThis as unknown as Record<string, unknown>;
installBase64(runtime);
if (!runtime.ReadableStream) {runtime.ReadableStream = ReadableStream;}
if (!runtime.WritableStream) {runtime.WritableStream = WritableStream;}
if (!runtime.TransformStream) {runtime.TransformStream = TransformStream;}

// Older Android/Hermes hosts do not expose these recent web APIs.
const signals = AbortSignal as typeof AbortSignal & {any?: (signals: AbortSignal[]) => AbortSignal; timeout?: (ms: number) => AbortSignal};
if (!signals.any) {
  signals.any = inputs => {
    const controller = new AbortController();
    const remove = () => inputs.forEach(input => input.removeEventListener('abort', onAbort));
    const onAbort = () => {controller.abort(); remove();};
    for (const input of inputs) {
      if (input.aborted) {onAbort(); break;}
      input.addEventListener('abort', onAbort, {once: true});
    }
    return controller.signal;
  };
}
if (!signals.timeout) {
  signals.timeout = milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), milliseconds);
    return controller.signal;
  };
}
