/**
 * Shared project visibility semantics for settings, navigation, and filters.
 *
 * Legacy installs stored only enabledProjectIds. Missing or empty legacy lists
 * mean all projects are visible. New installs can persist projectVisibility:
 * 'only' with an empty list to mean that no project rows are selected.
 */

function projectId(project) {
  return project && project.id != null ? String(project.id) : null;
}

function isInbox(project) {
  return !!project && (project.is_inbox_project === true || project.inbox_project === true ||
    project.isInbox === true || String(project.name || '').toLowerCase() === 'inbox');
}

function usesOnlyMode(config) {
  if (config?.projectVisibility === 'all') return false;
  if (config?.projectVisibility === 'only') return true;
  // The explicit mode is authoritative when present. Legacy empty/missing
  // arrays historically meant all, while nonempty arrays were a whitelist.
  return Array.isArray(config?.enabledProjectIds) && config.enabledProjectIds.length > 0;
}

function visibleProjectIds(config = {}, projects = []) {
  const only = usesOnlyMode(config);
  const enabled = new Set((Array.isArray(config.enabledProjectIds) ? config.enabledProjectIds : [])
    .filter(id => id != null).map(String));
  const visible = [];
  for (const project of Array.isArray(projects) ? projects : []) {
    const id = projectId(project);
    if (id === null) continue;
    if (isInbox(project) || !only || enabled.has(id)) visible.push(id);
  }
  return visible;
}

function isProjectVisible(config = {}, id, projects = []) {
  const normalizedId = id == null ? null : String(id);
  if (normalizedId === null) return false;
  const project = (Array.isArray(projects) ? projects : []).find(item => projectId(item) === normalizedId);
  if (project && isInbox(project)) return true;
  if (!usesOnlyMode(config)) return true;
  return new Set((Array.isArray(config.enabledProjectIds) ? config.enabledProjectIds : [])
    .filter(value => value != null).map(String)).has(normalizedId);
}

/** Return the settings fields to persist after a user toggles a project. */
function toggleProjectVisibility(config = {}, id, projects = []) {
  if (id == null) return {};
  const normalizedId = String(id);
  const project = (Array.isArray(projects) ? projects : []).find(item => projectId(item) === normalizedId);
  // Inbox has its own always-available navigation item, so it isn't controlled
  // by the project-list visibility setting.
  if (project && isInbox(project)) return {};

  let selected;
  if (usesOnlyMode(config)) {
    selected = new Set((Array.isArray(config.enabledProjectIds) ? config.enabledProjectIds : [])
      .filter(value => value != null).map(String));
  } else {
    // Convert all-visible (including legacy empty arrays) into an explicit
    // whitelist before toggling the requested project off.
    selected = new Set((Array.isArray(projects) ? projects : [])
      .filter(item => !isInbox(item)).map(projectId).filter(value => value !== null));
  }

  if (selected.has(normalizedId)) selected.delete(normalizedId);
  else selected.add(normalizedId);
  return {projectVisibility: 'only', enabledProjectIds: Array.from(selected)};
}

module.exports = {visibleProjectIds, isProjectVisible, toggleProjectVisibility};
