Object.assign(GraphView.prototype, {
  colors() {
    if (this._col) return this._col;
    const cs = getComputedStyle(this.contentEl);
    const v = (name, fb) => (cs.getPropertyValue(name) || '').trim() || fb;
    const pal = PALETTE.map((c, i) => v(`--nd-c${i + 1}`, c));
    // canvas can't read var() or every CSS colour form: resolve once to rgb and build alpha variants
    const rgb = (str) => parseColor(str).map((x) => Math.round(x * 255)).join(',');
    const palRgb = pal.map(rgb);
    return (this._col = {
      pal,
      a: (i, alpha) => `rgba(${palRgb[i % palRgb.length]},${alpha})`,
      text: v('--nd-text', v('--text-normal', '#e4e6ea')),
      bg: v('--nd-bg', v('--background-primary', '#121418')),
      surface: v('--nd-surface', v('--background-secondary', '#191c21')),
      muted: v('--nd-muted', v('--text-faint', '#8f95a0')),
      hot: v('--nd-accent', '#e5506a'),
      hotA: (alpha) => `rgba(${rgb(v('--nd-accent', '#e5506a'))},${alpha})`,
      font: v('--nd-font-ui', '"Space Grotesk", sans-serif').replace(/var\([^)]*\),?\s*/g, ''),
      dark: !document.body.hasClass('theme-light'),
    });
  },
  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.cw) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    if (!this.nodes.length) return;
    const col = this.colors();
    const cam = this.cam;
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.k, cam.k);
    // the dimming fades in and out (~0.2 s) instead of switching in one frame
    const now = performance.now();
    const cur = this.focusSet();
    if (cur) this.fadeSet = cur;
    const target = cur ? 1 : 0;
    // a fade that just starts takes one frame's step, not the idle time since the last draw
    const dt = this.fadeBusy && this.fadeAt ? Math.min(50, now - this.fadeAt) : 16;
    this.fadeAt = now;
    let k = this.fadeK == null || prefersReducedMotion() ? target : this.fadeK + (target - this.fadeK) * Math.min(1, dt / 60);
    if (Math.abs(target - k) < 0.02) k = target;
    this.fadeK = k;
    this.fadeBusy = k !== target;
    if (!k) this.fadeSet = null;
    const focus = k ? this.fadeSet : null;
    const mix = (a, b) => a + (b - a) * k;
    ctx.lineCap = 'round';
    // calm style: links one quiet grey, lit in the accent only around the focus; nodes plain accent dots with a faint glow
    const linkA = (col.dark ? 0.16 : 0.1) * clamp(250 / Math.max(1, this.links.length), 0.35, 1);
    ctx.strokeStyle = col.muted;
    ctx.lineWidth = 0.8 / Math.sqrt(cam.k);
    ctx.globalAlpha = mix(linkA, 0.03);
    ctx.beginPath();
    for (const l of this.links) {
      if (focus && focus.has(l.s.i) && focus.has(l.t.i)) continue; // drawn below, grey then lit
      ctx.moveTo(l.s.x, l.s.y);
      ctx.lineTo(l.t.x, l.t.y);
    }
    ctx.stroke();
    if (focus) {
      const lit = () => {
        ctx.beginPath();
        for (const l of this.links) {
          if (!focus.has(l.s.i) || !focus.has(l.t.i)) continue;
          ctx.moveTo(l.s.x, l.s.y);
          ctx.lineTo(l.t.x, l.t.y);
        }
        ctx.stroke();
      };
      ctx.globalAlpha = linkA;
      lit();
      ctx.strokeStyle = col.hot;
      ctx.lineWidth = 1.2 / Math.sqrt(cam.k);
      ctx.globalAlpha = 0.55 * k;
      lit();
    }
    // drawn size: smaller than the hit size n.r, so hubs read as bigger dots, not balloons
    const dr = (n) => 2.5 + n.r * 0.45;
    ctx.fillStyle = col.hot;
    for (const n of this.nodes) {
      const on = !focus || focus.has(n.i);
      ctx.globalAlpha = on ? 0.9 : mix(0.9, 0.12);
      if (col.dark && (on || k < 0.5)) {
        ctx.shadowColor = col.hotA(0.35);
        ctx.shadowBlur = 6;
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, dr(n), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    // hover / selection: one plain ring
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col.text;
    ctx.lineWidth = 1.5 / cam.k;
    for (const i of [this.selected, this.hover]) {
      const n = i >= 0 && this.nodes[i];
      if (!n) continue;
      ctx.beginPath();
      ctx.arc(n.x, n.y, dr(n) + 3 / cam.k, 0, Math.PI * 2);
      ctx.stroke();
    }
    // names: hovered or picked always; hubs and the focus with labels on; everything once zoomed in
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const n of this.nodes) {
      const special = n.i === this.hover || n.i === this.selected;
      const on = !focus || focus.has(n.i);
      const hub = n.r > 12;
      if (!special && !(this.showLabels && (hub || (focus && on) || cam.k > 1.4))) continue;
      const fs = 10 + n.r * 0.25;
      if (!special && fs * cam.k < 7) continue;
      ctx.globalAlpha = on ? 1 : mix(1, 0.14);
      ctx.font = `${special ? 700 : 500} ${fs}px ${col.font}`;
      ctx.lineWidth = 3.6;
      ctx.strokeStyle = col.bg;
      const y = n.y + dr(n) + fs * 0.8;
      ctx.strokeText(n.label, n.x, y);
      ctx.fillStyle = special ? col.text : col.muted;
      ctx.fillText(n.label, n.x, y);
    }
    ctx.globalAlpha = 1;
  },

  kick() {
    if (this.raf || this.closed) return;
    const loop = (now) => {
      this.raf = 0;
      let busy = false;
      if (this.sim && this.sim.alpha > 0.004) {
        this.sim.tick();
        this.dirty = true;
        busy = true;
      }
      if (this.camAnim) {
        const a = this.camAnim;
        const t = clamp((now - a.t0) / a.dur, 0, 1);
        const e = 1 - Math.pow(1 - t, 3);
        this.cam = {
          k: a.from.k + (a.to.k - a.from.k) * e,
          x: a.from.x + (a.to.x - a.from.x) * e,
          y: a.from.y + (a.to.y - a.from.y) * e,
        };
        if (t >= 1) this.camAnim = null;
        this.dirty = true;
        busy = true;
      }
      if (this.dirty) {
        this.draw();
        this.dirty = !!this.fadeBusy; // keep drawing until the dimming has faded in or out
        busy = busy || this.fadeBusy;
      }
      if (busy || this.drag) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },
  requestDraw() {
    this.dirty = true;
    this.kick();
  },

  hit(x, y) {
    for (let j = this.nodes.length - 1; j >= 0; j--) {
      const n = this.nodes[j];
      const r = n.r + 4 / this.cam.k;
      if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) return n;
    }
    return null;
  },

  bindCanvas() {
    const cv = this.canvas;
    const pt = (e) => {
      const r = cv.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      return { sx, sy, x: (sx - this.cam.x) / this.cam.k, y: (sy - this.cam.y) / this.cam.k };
    };
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = pt(e);
      const n = this.hit(p.x, p.y);
      cv.setPointerCapture(e.pointerId);
      this.camAnim = null;
      this.drag = { n, sx: p.sx, sy: p.sy, camX: this.cam.x, camY: this.cam.y, moved: false };
      if (n) n.fixed = true;
      cv.addClass('is-grabbing');
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pt(e);
      const d = this.drag;
      if (d) {
        if (!d.moved && Math.hypot(p.sx - d.sx, p.sy - d.sy) > 4) d.moved = true;
        if (!d.moved) return;
        if (d.n) {
          d.n.x = p.x;
          d.n.y = p.y;
          if (this.sim) this.sim.alpha = Math.max(this.sim.alpha, 0.15);
          this.requestDraw();
        } else {
          this.cam.x = d.camX + (p.sx - d.sx);
          this.cam.y = d.camY + (p.sy - d.sy);
          this.requestDraw();
        }
        return;
      }
      const n = this.hit(p.x, p.y);
      const h = n ? n.i : -1;
      if (h !== this.hover) {
        this.hover = h;
        cv.toggleClass('is-hovering', !!n);
        this.requestDraw();
      }
    });
    const end = (e) => {
      const d = this.drag;
      this.drag = null;
      cv.removeClass('is-grabbing');
      if (!d) return;
      if (d.n) d.n.fixed = e.altKey;
      if (!d.moved) this.select(d.n ? d.n.i : -1);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => {
      if (this.hover !== -1 && !this.drag) {
        this.hover = -1;
        this.requestDraw();
      }
    });
    cv.addEventListener('dblclick', (e) => {
      const p = pt(e);
      const n = this.hit(p.x, p.y);
      if (n) this.activateNode(n, e);
      else this.fit(true);
    });
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = pt(e);
        const k = clamp(this.cam.k * Math.exp(-e.deltaY * 0.0015), 0.06, 6);
        this.camAnim = null;
        this.cam = { k, x: p.sx - p.x * k, y: p.sy - p.y * k };
        this.requestDraw();
      },
      { passive: false },
    );
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = pt(e);
      const n = this.hit(p.x, p.y);
      if (n) this.nodeMenu(n, e);
    });
  },

});
