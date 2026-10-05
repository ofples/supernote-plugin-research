// Collection visibility is a session-only view preference. Missing entries stay expanded.
const collapsed = new Set();

function collectionCollapseKey(projectId, collectionId) {
  return `${String(projectId)}:${String(collectionId)}`;
}

function isCollectionExpanded(projectId, collectionId) {
  return !collapsed.has(collectionCollapseKey(projectId, collectionId));
}

function toggleCollectionExpanded(projectId, collectionId) {
  const key = collectionCollapseKey(projectId, collectionId);
  if (collapsed.has(key)) {
    collapsed.delete(key);
    return true;
  }
  collapsed.add(key);
  return false;
}

function setProjectCollectionsExpanded(projectId, collections, expanded) {
  for (const collection of collections) {
    const key = collectionCollapseKey(projectId, collection.id);
    if (expanded) collapsed.delete(key);
    else collapsed.add(key);
  }
}

module.exports = {collectionCollapseKey, isCollectionExpanded, toggleCollectionExpanded, setProjectCollectionsExpanded};
