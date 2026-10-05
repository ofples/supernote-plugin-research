// Pure transport. A worker owns retries; this layer performs one timed request.
function createTransport(token, request, allowNetwork, timeoutMs = 20000) {
  let accountJoinedAt = null;
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
  async function get(path) {
    if (!(await allowNetwork())) {throw new Error('Todoist access is not allowed. Enable Sync with Todoist in settings.');}
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await request(`https://api.todoist.com/api/v1/${path}`, {
        method: 'GET', signal: controller.signal, headers: {Authorization: `Bearer ${token}`},
      });
      if (response.status === 404) {return null;}
      if (!response.ok) {
        const error = new Error(`Todoist request failed (HTTP ${response.status}).`);
        error.status = response.status;
        const retry = response.headers?.get?.('retry-after');
        if (retry) {error.retryAfterMs = Math.max(0, Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Date.parse(retry) - Date.now() || 0);}
        throw error;
      }
      const value = await response.json();
      if (!value || typeof value !== 'object' || Array.isArray(value)) {throw new Error('Invalid Todoist task response.');}
      return value;
    } catch (error) {
      if (error.name === 'AbortError') {throw new Error('Todoist request timed out. Changes remain saved locally.');}
      throw error;
    } finally {clearTimeout(timer);}
  }
  return {
    async fetchArchivedProjects(maxPages = 30) {
      const projects = []; let cursor = null;
      for (let page = 0; page < maxPages; page++) {
        const result = await get(`projects/archived?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        const rows = result?.results || result?.items;
        if (!Array.isArray(rows)) {throw new Error('Todoist did not provide a complete archived-project list.');}
        projects.push(...rows); cursor = result.next_cursor;
        if (!cursor) {return {complete: true, projects};}
      }
      return {complete: false, projects};
    },
    async fetchContainerHistorySince(kind, id, sinceAt, maxPages = 30) {
      const start = Date.parse(sinceAt), end = Date.now() + 60000;
      if (!Number.isFinite(start) || start > end) {return {complete: false, tasks: []};}
      let pages = 0; const tasks = [];
      for (let since = start; since < end; since += 89 * 86400000) {
        const until = Math.min(end, since + 89 * 86400000); let cursor = null;
        do {
          if (++pages > maxPages) {return {complete: false, tasks};}
          const query = `${kind === 'project' ? 'project_id' : 'section_id'}=${encodeURIComponent(id)}&since=${encodeURIComponent(new Date(since).toISOString())}&until=${encodeURIComponent(new Date(until).toISOString())}&limit=200` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
          const result = await get(`tasks/completed/by_completion_date?${query}`);
          if (!result || !Array.isArray(result.items)) {throw new Error('Invalid completed-history verification response.');}
          tasks.push(...result.items); cursor = result.next_cursor;
        } while (cursor);
      }
      return {complete: true, tasks};
    },
    async verifyContainerHistory(kind, id, createdAt, maxPages = 30) {
      // Account lifetime bounds an advisory dated scan, not all history:
      // backdated/imported completions can precede even joined_at. The worker
      // must not promote a complete range scan into a full-container proof.
      if (!accountJoinedAt) {accountJoinedAt = (await syncRequest([], ['user'])).user?.joined_at || null;}
      const start = Date.parse(accountJoinedAt), end = Date.now() + 60000;
      if (!Number.isFinite(start) || start > end) {return {complete: false, reason: 'Todoist did not provide a verified account creation date for complete history.'};}
      if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 120) {throw new Error('Completed-history verification budget must be between 1 and 120 requests.');}
      const tasks = []; let pages = 0;
      // v1 completed-history date ranges are at most three months. A hard
      // request budget makes old or very large containers explicitly incomplete.
      for (let until = end; until > start; until -= 89 * 86400000) {
        const since = Math.max(start, until - 89 * 86400000); let cursor = null;
        do {
          if (++pages > maxPages) {return {complete: false, tasks, reason: 'Completed-history verification reached its request limit. Keep tasks is unavailable for this scope.'};}
          const query = `${kind === 'project' ? 'project_id' : 'section_id'}=${encodeURIComponent(id)}&since=${encodeURIComponent(new Date(since).toISOString())}&until=${encodeURIComponent(new Date(until).toISOString())}&limit=200` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
          const result = await get(`tasks/completed/by_completion_date?${query}`);
          if (!result || !Array.isArray(result.items)) {throw new Error('Invalid completed-history verification response.');}
          tasks.push(...result.items); cursor = result.next_cursor;
        } while (cursor);
      }
      return {complete: true, tasks};
    },
    async userId() {
      const result = await syncRequest([], ['user']);
      if (!result.user?.id) {throw new Error('Todoist did not identify the account.');}
      accountJoinedAt = result.user.joined_at || null;
      return String(result.user.id);
    },
    commands: commands => syncRequest(commands),
    async fetchTask(id, cached = {}) {
      const task = await get(`tasks/${encodeURIComponent(id)}`);
      if (task) {
        if (task.id !== id || typeof task.content !== 'string') {throw new Error('Invalid Todoist task response.');}
        return {status: 'found', task};
      }
      // GET task is documented as active-only. A 404 is also possible for a
      // completed/inaccessible task; it is never evidence of deletion.
      const end = new Date(Date.now() + 60000);
      const start = new Date(end); start.setUTCDate(start.getUTCDate() - 89);
      const windows = [{since: start.toISOString(), until: end.toISOString()}];
      if (cached.completed_at && Number.isFinite(Date.parse(cached.completed_at)) && Date.parse(cached.completed_at) < start.getTime()) {
        const date = new Date(cached.completed_at);
        windows.push({since: new Date(date.getTime() - 86400000).toISOString(), until: new Date(date.getTime() + 86400000).toISOString()});
      }
      for (const window of windows) {
        let cursor;
        for (let page = 0; page < 100; page++) {
          const query = `since=${encodeURIComponent(window.since)}&until=${encodeURIComponent(window.until)}&limit=200` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
          const result = await get(`tasks/completed/by_completion_date?${query}`);
          if (!result || !Array.isArray(result.items)) {throw new Error('Invalid Todoist completed task response.');}
          const found = result.items.find(t => t.id === id);
          if (found) {return {status: 'found', task: {...found, is_completed: true, completed: true}};}
          cursor = result.next_cursor;
          if (!cursor) {break;}
        }
      }
      return {status: 'unavailable'};
    },
    async fetchSnapshot() {
      const result = await syncRequest([], ['items', 'projects', 'sections']);
      if (result.full_sync !== true || !Array.isArray(result.items) || !Array.isArray(result.projects) || !Array.isArray(result.sections)) {
        throw new Error('Todoist returned an incomplete task snapshot; cached tasks were retained.');
      }
      return {tasks: result.items.filter(t => !t.is_deleted), projects: result.projects.filter(p => !p.is_deleted && !p.is_archived),
        sections: result.sections.filter(s => !s.is_deleted && !s.is_archived)};
    },
  };
}
module.exports = {createTransport};
