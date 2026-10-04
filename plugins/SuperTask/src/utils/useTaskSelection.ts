/** Shared immediate completion with persistent undo and an in-flight guard. */
import {useRef, useState} from 'react';
import {completeTask, reopenTask} from '../api/todoist';
type Opts = {onCompleted?: (ids: string[]) => void; onUndone?: (ids: string[]) => void; onError?: (msg: string) => void};
export function useTaskSelection(_tag: string, opts: Opts) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [undoIds, setUndoIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const toggleSelect = (id: string) => setSelectedIds(prev => prev.includes(id) ? prev.filter(value => value !== id) : [...prev, id]);
  const clearSelection = () => {setSelectedIds([]); setUndoIds([]);};
  const complete = async (ids: string[]) => {
    if (inFlight.current || !ids.length) return;
    inFlight.current = true; setBusy(true);
    const done: string[] = []; const failed: string[] = [];
    try {
      for (const id of ids) {try {await completeTask(id); done.push(id);} catch {failed.push(id);}}
      setSelectedIds([]);
      if (done.length) {setUndoIds(done); opts.onCompleted?.(done);}
      if (failed.length) opts.onError?.(`Could not complete ${failed.length} task${failed.length === 1 ? '' : 's'}. Tap its checkbox to retry.`);
    } finally {inFlight.current = false; setBusy(false);}
  };
  const completeOne = (id: string) => complete([id]);
  const completeSelected = () => complete(selectedIds);
  const undo = async () => {
    if (inFlight.current || !undoIds.length) return;
    inFlight.current = true; setBusy(true);
    const back: string[] = []; const failed: string[] = [];
    try {
      for (const id of undoIds) {
        try {await reopenTask(id); back.push(id);} catch (error: any) {
          failed.push(id);
          opts.onError?.(error?.code === 'RECURRING_UNDO_UNSUPPORTED'
            ? 'This recurring completion has already synced. Undo it in Todoist; the next occurrence stays active.'
            : 'Could not undo this completion. Your task state is preserved; retry when sync is available.');
        }
      }
      setUndoIds(failed);
      if (back.length) opts.onUndone?.(back);
    } finally {inFlight.current = false; setBusy(false);}
  };
  const dismissUndo = () => setUndoIds([]);
  return {selectedIds, undoIds, busy, active: selectedIds.length > 0 || undoIds.length > 0,
    toggleSelect, clearSelection, completeSelected, completeOne, undo, dismissUndo};
}
