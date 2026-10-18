const GROUPS_PER_PAGE = 2;

function paginateGroups(groups, requestedPage, pageSize = GROUPS_PER_PAGE) {
  const pageCount = Math.max(1, Math.ceil(groups.length / pageSize));
  const page = Math.min(Math.max(0, Math.floor(Number(requestedPage) || 0)), pageCount - 1);
  const start = page * pageSize;
  return {page, pageCount, groups: groups.slice(start, start + pageSize)};
}

module.exports = {GROUPS_PER_PAGE, paginateGroups};
