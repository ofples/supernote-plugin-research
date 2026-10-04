// One capture produces one review screen. Native OCR keeps running while an
// explicitly requested AI result has priority; stale results cannot navigate.
function captureChoice({review, status}) {
  let closed = false, requested = false, ocr, ocrError, token = 0;
  function useOCR() {
    if (closed) return;
    requested = false; token++;
    if (ocr) {closed = true; review({kind: 'ocr', value: ocr});}
    else status(ocrError || 'Waiting for device recognition…');
  }
  return {
    requestAI() {if (closed) return null; requested = true; return ++token;},
    ocrReady(value) {if (closed) return; ocr = value; if (!requested) useOCR();},
    ocrFailed(message) {if (closed) return; ocrError = message; if (!requested) status(message);},
    aiReady(id, value) {if (closed || !requested || id !== token) return; closed = true; review({kind: 'ai', value});},
    aiFailed(id, message) {if (closed || !requested || id !== token) return; status(message); useOCR();},
    useOCR,
    close() {closed = true; token++;},
  };
}
module.exports = {captureChoice};
