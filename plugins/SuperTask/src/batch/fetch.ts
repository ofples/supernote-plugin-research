// React Native fetch buffers responses and exposes text(), but no body stream.
// AI SDK 7 reads even non-streaming JSON through Response.body.
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const providerFetch: typeof fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init);
  if (response.body != null) {return response;}
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_RESPONSE_BYTES) {throw new Error('OpenAI response was too large. Select a smaller passage.');}
  const text = await response.text();
  if (init?.signal?.aborted) {throw new Error('Recognition cancelled.');}
  if (text.length > MAX_RESPONSE_BYTES) {throw new Error('OpenAI response was too large. Select a smaller passage.');}
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {throw new Error('OpenAI response was too large. Select a smaller passage.');}
  Object.defineProperty(response, 'body', {value: new ReadableStream<Uint8Array>({
    start(controller) {controller.enqueue(bytes); controller.close();},
  })});
  return response;
};
