/* ------------------------------------------------------------------ */
/* Force layout                                                        */
/* ------------------------------------------------------------------ */

class ForceSim {
  constructor(nodes, links) {
    this.nodes = nodes;
    this.links = links;
    this.alpha = 1;
    this.charge = 70;
    const cnt = new Float64Array(nodes.length);
    for (const l of links) {
      cnt[l.s.i]++;
      cnt[l.t.i]++;
    }
    for (const l of links) {
      l.bias = cnt[l.s.i] / (cnt[l.s.i] + cnt[l.t.i]);
      l.k = (0.35 + 0.65 * Math.min(1, Math.log2(1 + l.w) / 4)) / Math.min(cnt[l.s.i], cnt[l.t.i]);
      l.len = 34 + (l.s.r + l.t.r) * 1.3;
    }
    this.nc = nodes.reduce((m, n) => Math.max(m, n.c), 0) + 1;
    this.cx = new Float64Array(this.nc);
    this.cy = new Float64Array(this.nc);
    this.cn = new Float64Array(this.nc);
  }
  tick() {
    const ns = this.nodes;
    const n = ns.length;
    const a = this.alpha;
    for (const l of this.links) {
      const s = l.s;
      const t = l.t;
      let dx = t.x + t.vx - s.x - s.vx;
      let dy = t.y + t.vy - s.y - s.vy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
      const f = ((d - l.len) / d) * a * l.k;
      dx *= f;
      dy *= f;
      t.vx -= dx * l.bias;
      t.vy -= dy * l.bias;
      s.vx += dx * (1 - l.bias);
      s.vy += dy * (1 - l.bias);
    }
    for (let i = 0; i < n; i++) {
      const p = ns[i];
      for (let j = i + 1; j < n; j++) {
        const q = ns[j];
        let dx = q.x - p.x;
        let dy = q.y - p.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 640000) continue;
        if (d2 < 1) {
          dx = 0.5 + (i % 7) * 0.1;
          dy = 0.5 - (j % 5) * 0.1;
          d2 = dx * dx + dy * dy;
        }
        const f = (this.charge * (1 + (p.r + q.r) / 20) * a) / d2;
        p.vx -= dx * f;
        p.vy -= dy * f;
        q.vx += dx * f;
        q.vy += dy * f;
      }
    }
    const { cx, cy, cn } = this;
    cx.fill(0);
    cy.fill(0);
    cn.fill(0);
    for (const p of ns) {
      cx[p.c] += p.x;
      cy[p.c] += p.y;
      cn[p.c]++;
    }
    for (const p of ns) {
      const c = p.c;
      p.vx += (cx[c] / cn[c] - p.x) * 0.05 * a - p.x * 0.012 * a;
      p.vy += (cy[c] / cn[c] - p.y) * 0.05 * a - p.y * 0.012 * a;
    }
    for (const p of ns) {
      if (p.fixed) {
        p.vx = p.vy = 0;
        continue;
      }
      p.vx *= 0.6;
      p.vy *= 0.6;
      p.x += p.vx;
      p.y += p.vy;
    }
    for (let i = 0; i < n; i++) {
      const p = ns[i];
      for (let j = i + 1; j < n; j++) {
        const q = ns[j];
        const min = p.r + q.r + 6;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = ((min - d) / d) * 0.5;
        const wp = p.fixed ? 0 : q.fixed ? 1 : 0.5;
        const wq = q.fixed ? 0 : p.fixed ? 1 : 0.5;
        p.x -= dx * push * wp * 2;
        p.y -= dy * push * wp * 2;
        q.x += dx * push * wq * 2;
        q.y += dy * push * wq * 2;
      }
    }
    this.alpha += (0 - this.alpha) * 0.02;
  }
}

