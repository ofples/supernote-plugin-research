import {useRef, useState} from 'react';
const {createIntentQueue} = require('./intents');
const service = require('../offline/service');

export default function useWorkspaceMutations(refresh: () => Promise<void>, onError: (message: string) => void) {
  const [intents, setIntents] = useState<any[]>([]);
  const live = useRef({refresh, onError}); live.current = {refresh, onError};
  const queue = useRef<any>(null);
  if (!queue.current) queue.current = createIntentQueue({
    changed: setIntents,
    failed: (error: any) => live.current.onError(error?.message || 'Could not save this change. Your previous task is preserved.'),
    commit: async (ids: string[], action: any, request: any) => {
      if (action.kind === 'order') await service.reorderOfflineTask(action.taskId, action.direction, request);
      else await service.mutateOfflineTasks(ids, action, request);
      // Commit success is durable even if a subsequent presentation read fails.
      await live.current.refresh().catch(() => {});
    },
  });
  const mutate = (ids: string[], action: any) => queue.current.submit(ids, action).catch(() => {});
  return {intents, mutate};
}
