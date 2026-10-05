import {useEffect, useRef, useState} from 'react';
const {createIntentQueue} = require('./intents');
const service = require('../offline/service');

export default function useWorkspaceMutations(refresh: () => Promise<void>, onError: (message: string) => void, account: () => any = () => null) {
  const [intents, setIntents] = useState<any[]>([]);
  const [failures, setFailures] = useState<any[]>([]);
  const live = useRef({refresh, onError, account}); live.current = {refresh, onError, account};
  const queue = useRef<any>(null);
  if (!queue.current) queue.current = createIntentQueue({
    changed: (pending: any[], errors: any[]) => {setIntents(pending); setFailures(errors);},
    account: () => live.current.account(),
    failed: (error: any) => live.current.onError(error?.uncertainCommit ? 'This save is uncertain. Retry reconciles the same change and identity.' : error?.message || 'Could not save this change. Retry is available.'),
    commit: async (ids: string[], action: any, request: any) => {
      if (action.kind === 'order') await service.reorderOfflineTask(action.taskId, action.direction, request);
      else await service.mutateOfflineTasks(ids, action, request);
      // Commit success is durable even if a subsequent presentation read fails.
      await live.current.refresh().catch(() => {});
    },
  });
  useEffect(() => () => queue.current.cancel(false), []);
  const mutate = (ids: string[], action: any) => queue.current.submit(ids, action).catch(() => {});
  return {intents, failures, mutate, retry: (sequence: number) => queue.current.retry(sequence).catch(() => {}), cancel: () => queue.current.cancel()};
}
