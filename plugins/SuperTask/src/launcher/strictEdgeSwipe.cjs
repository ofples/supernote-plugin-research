// MotionEvent coordinates are physical pixels. Never infer screen bounds from contacts.
class StrictEdgeSwipe {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.lastPen = -Infinity;
    this.lastLaunch = -Infinity;
    this.reset();
  }
  setDimensions(width, height) {
    this.width = Number.isFinite(width) && width > 0 ? width : 0;
    this.height = Number.isFinite(height) && height > 0 ? height : 0;
    this.reset();
  }
  reset() {
    this.session = null;
  }
  feed(event, enabled = true, blocked = false) {
    const t = event?.eventTime;
    const action = Number.isInteger(event?.action) ? event.action & 255 : -1;
    const points = event?.pointers;
    const reject = () => {
      this.reset();
      return false;
    };
    if (Number.isFinite(t) && event.toolType !== 1) this.lastPen = t;
    if (
      !Number.isFinite(t) ||
      !Array.isArray(points) ||
      points.length !== event.pointerCount ||
      !points.length
    )
      return reject();
    if (event.toolType !== 1 || points.some(p => p.toolType !== 1)) {
      this.lastPen = t;
      return reject();
    }
    if (
      !enabled ||
      blocked ||
      !this.width ||
      !this.height ||
      t - this.lastPen < 1500 ||
      t - this.lastLaunch < 1800
    )
      return reject();
    if (
      points.length > 3 ||
      new Set(points.map(p => p.pointerId)).size !== points.length ||
      points.some(
        p =>
          !Number.isInteger(p.pointerId) ||
          !Number.isFinite(p.x) ||
          !Number.isFinite(p.y) ||
          p.x < 0 ||
          p.x > this.width ||
          p.y < 0 ||
          p.y > this.height,
      )
    )
      return reject();
    if (action === 0) {
      // A second DOWN in an unfinished stream is ambiguous; do not recover mid-stream.
      if (
        this.session ||
        points.length !== 1 ||
        points[0].y < this.height * 0.96
      )
        return reject();
      this.session = {
        start: t,
        last: t,
        contacts: new Map(),
        moves: 0,
        release: null,
        qualified: false,
      };
    }
    const s = this.session;
    if (
      !s ||
      t < s.last ||
      t - s.start > 3500 ||
      action === 3 ||
      ![0, 1, 2, 5, 6].includes(action)
    )
      return reject();
    s.last = t;
    const active = [...s.contacts.values()].filter(p => !p.up);
    if (action === 0 || action === 5) {
      if (
        s.release !== null ||
        t - s.start > 250 ||
        points.length !== active.length + 1
      )
        return reject();
      const added = points.filter(p => !s.contacts.has(p.pointerId));
      if (added.length !== 1 || added[0].y < this.height * 0.96)
        return reject();
      const p = added[0];
      s.contacts.set(p.pointerId, {
        x: p.x,
        y: p.y,
        lastX: p.x,
        lastY: p.y,
        up: false,
      });
      const starts = [...s.contacts.values()];
      if (
        starts.some((p1, i) =>
          starts.slice(i + 1).some(p2 => Math.abs(p1.x - p2.x) < 16),
        ) ||
        Math.max(...starts.map(p1 => p1.x)) -
          Math.min(...starts.map(p1 => p1.x)) >
          Math.min(350, this.width * 0.4)
      )
        return reject();
    } else if (points.length !== active.length) return reject();
    for (const p of points) {
      const c = s.contacts.get(p.pointerId);
      if (
        !c ||
        c.up ||
        Math.abs(p.x - c.x) > 45 ||
        Math.hypot(p.x - c.lastX, p.y - c.lastY) > 120 ||
        p.y - c.lastY > 15
      )
        return reject();
      if (s.contacts.size < 3 && Math.abs(p.y - c.y) > 20) return reject();
      c.lastX = p.x;
      c.lastY = p.y;
    }
    const travels = [...s.contacts.values()].map(c => c.y - c.lastY);
    if (Math.max(...travels) - Math.min(...travels) > 60) return reject();
    if (action === 2 && s.contacts.size === 3 && s.release === null) {
      s.moves++;
      s.qualified =
        s.moves >= 3 && t - s.start >= 300 && travels.every(d => d >= 150);
    }
    if (action === 6 || action === 1) {
      // Require all three contacts to qualify while concurrently down, before any lift.
      if (
        !s.qualified ||
        s.contacts.size !== 3 ||
        (s.release !== null && t - s.release > 250)
      )
        return reject();
      const index = Number.isInteger(event.actionIndex)
        ? event.actionIndex
        : (event.action >> 8) & 255;
      if (
        index < 0 ||
        index >= points.length ||
        (action === 1 && points.length !== 1)
      )
        return reject();
      s.release = s.release ?? t;
      s.contacts.get(points[index].pointerId).up = true;
      if (action === 1) {
        if ([...s.contacts.values()].some(c => !c.up)) return reject();
        this.lastLaunch = t;
        this.reset();
        return true;
      }
    }
    return false;
  }
}
module.exports = {StrictEdgeSwipe};
