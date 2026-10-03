// Pure transport. A worker owns retries; this layer performs one timed request.
function createTransport(token, request, allowNetwork, timeoutMs = 20000) {
  async function syncRequest(commands, resourceTypes = []) {
    if (!(await allowNetwork())) {throw new Error('Todoist access is not allowed. Enable Sync with Todoist in settings.');}
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = `commands=${encodeURIComponent(JSON.stringify(commands))}` +
        `&sync_token=*&resource_types=${encodeURIComponent(JSON.stringify(resourceTypes))}`;
      const response = await request('https://api.todoist.com/api/v1/sync', {
        method: 'POST', signal: controller.signal,
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded'}, body,
      });
      if (!response.ok) {
        // Error bodies can contain echoed user content. Keep logs/status concise.
        const error = new Error(`Todoist request failed (HTTP ${response.status}).`);
        error.status = response.status;
        const retry = response.headers?.get?.('retry-after');
        const seconds = Number(retry);
        const dateMs = retry ? Date.parse(retry) - Date.now() : 0;
        error.retryAfterMs = Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : dateMs || 0);
        throw error;
      }
      const result = await response.json();
      if (!result || typeof result !== 'object' || Array.isArray(result)) {throw new Error('Invalid Todoist sync response.');}
      return result;
    } catch (error) {
      if (error.name === 'AbortError') {throw new Error('Todoist request timed out. Changes remain saved locally.');}
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async userId() {
      const result = await syncRequest([], ['user']);
      if (!result.user?.id) {throw new Error('Todoist did not identify the account.');}
      return String(result.user.id);
    },
    commands: commands => syncRequest(commands),
    async fetchSnapshot() {
      const result = await syncRequest([], ['items', 'projects']);
      if (result.full_sync !== true || !Array.isArray(result.items) || !Array.isArray(result.projects)) {
        throw new Error('Todoist returned an incomplete task snapshot; cached tasks were retained.');
      }
      return {tasks: result.items.filter(t => !t.is_deleted), projects: result.projects.filter(p => !p.is_deleted && !p.is_archived)};
    },
  };
}
module.exports = {createTransport};
