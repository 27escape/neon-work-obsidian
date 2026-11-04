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
    const pal = col.pal;
    const cam = this.cam;
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.k, cam.k);
    const focus = this.focusSet();
    ctx.lineCap = 'round';
    // links: thin and quiet, so the nodes carry the picture; same-cluster links take the cluster colour
    // dense graphs get fainter links, so a thousand of them read as structure, not haze
    // (dark lines on a light page read heavier, so light themes go lighter still)
    const linkA = (col.dark ? 0.24 : 0.14) * clamp(250 / Math.max(1, this.links.length), 0.3, 1);
    for (const l of this.links) {
      const on = !focus || (focus.has(l.s.i) && focus.has(l.t.i));
      ctx.globalAlpha = on ? (focus ? 0.75 : linkA) : 0.03;
      ctx.strokeStyle = l.s.c === l.t.c ? pal[l.s.c % pal.length] : col.muted;
      ctx.lineWidth = (0.5 + 1.8 * Math.sqrt(l.w / this.maxW)) / Math.sqrt(cam.k);
      ctx.beginPath();
      ctx.moveTo(l.s.x, l.s.y);
      ctx.lineTo(l.t.x, l.t.y);
      ctx.stroke();
    }
    // nodes: a dark core lit from inside by the cluster colour, a crisp ring, a soft glow (dark themes);
    // light themes get the same shape without the glow
    const glowK = Math.min(1.6, Math.max(0.6, cam.k));
    for (const n of this.nodes) {
      const on = !focus || focus.has(n.i);
      ctx.globalAlpha = on ? 1 : 0.1;
      const c = pal[n.c % pal.length];
      const hub = n.r > 12;
      const core = ctx.createRadialGradient(n.x - n.r * 0.3, n.y - n.r * 0.35, n.r * 0.1, n.x, n.y, n.r);
      core.addColorStop(0, col.a(n.c, col.dark ? 0.55 : 0.35));
      core.addColorStop(1, col.dark ? col.a(n.c, 0.08) : col.a(n.c, 0.12));
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = col.surface;
      if (col.dark && on) {
        ctx.shadowColor = col.a(n.c, hub ? 0.75 : 0.5);
        ctx.shadowBlur = (hub ? 22 : 10) * glowK;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = core;
      ctx.fill();
      ctx.lineWidth = (hub ? 2.2 : 1.6) / Math.sqrt(cam.k);
      ctx.strokeStyle = c;
      ctx.stroke();
      if (hub) {
        // a faint outer orbit marks the hubs
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 4, 0, Math.PI * 2);
        ctx.lineWidth = 1 / cam.k;
        ctx.strokeStyle = col.a(n.c, 0.35);
        ctx.stroke();
      }
      if (n.kind === 'link' || n.kind === 'tag') {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(n.x, n.y, Math.max(1.5, n.r * 0.24), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // hover / selection: an accent ring with a slow ripple
    const special = [this.selected, this.hover].filter((i, k, arr) => i >= 0 && arr.indexOf(i) === k);
    if (special.length) {
      const still = prefersReducedMotion();
      const phase = still ? 0 : (performance.now() % 1600) / 1600;
      ctx.globalAlpha = 1;
      for (const i of special) {
        const n = this.nodes[i];
        if (!n) continue;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3 / cam.k + 2, 0, Math.PI * 2);
        ctx.lineWidth = 2 / cam.k;
        ctx.strokeStyle = col.hot;
        ctx.shadowColor = col.hotA(0.6);
        ctx.shadowBlur = col.dark ? 12 : 0;
        ctx.stroke();
        ctx.shadowBlur = 0;
        if (!still) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + (4 + phase * 12) / cam.k + 2, 0, Math.PI * 2);
          ctx.lineWidth = 1.5 / cam.k;
          ctx.strokeStyle = col.hotA(0.55 * (1 - phase));
          ctx.stroke();
        }
      }
      // keep the ripple moving while something is hovered or selected, but only while the graph is on
      // screen and Obsidian is focused, and at ~30 fps: a hidden graph tab must cost nothing
      if (!still && !this.pulseQueued && this.contentEl.offsetParent && document.hasFocus()) {
        this.pulseQueued = true;
        window.setTimeout(() => {
          this.pulseQueued = false;
          if ((this.selected >= 0 || this.hover >= 0) && this.contentEl.offsetParent) this.requestDraw();
        }, 33);
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const n of this.nodes) {
      const special = n.i === this.hover || n.i === this.selected;
      const on = !focus || focus.has(n.i);
      if (!this.showLabels && !special) continue;
      const fs = 9 + n.r * 0.55;
      if (!special && fs * cam.k < 7 && !(focus && on)) continue;
      ctx.globalAlpha = on ? 1 : 0.14;
      ctx.font = `${n.r > 12 || special ? 700 : 500} ${fs}px ${col.font}`;
      ctx.lineWidth = 3.6;
      ctx.strokeStyle = col.bg;
      const y = n.y + n.r + fs * 0.72;
      ctx.strokeText(n.label, n.x, y);
      // hubs speak up, small nodes stay quiet
      ctx.fillStyle = special ? col.hot : n.r > 12 ? col.text : col.muted;
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
        this.dirty = false;
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
