/* ------------------------------------------------------------------ */
/* Live pattern background (WebGL)                                     */
/* One canvas behind a view. Cards are solid in the middle, so the     */
/* pattern only shows at card edges and, very faintly, in the gaps.    */
/* ------------------------------------------------------------------ */

const PATTERNS = ['damascus', 'prism', 'meteorite', 'topo', 'hex', 'datastream', 'blackwall', 'blackice', 'none'];
const PATTERN_LABEL = {
  damascus: 'Damascus', meteorite: 'Meteorite', topo: 'Topo', prism: 'Prism', hex: 'Hex mesh',
  datastream: 'Datastream', blackwall: 'Blackwall', blackice: 'Black ICE', none: 'None',
};
const PATTERN_MODE = { damascus: 0, meteorite: 1, topo: 2, prism: 3, hex: 4, datastream: 5, blackwall: 6, blackice: 7 };
const STRENGTHS = ['off', 'subtle', 'bold'];
const STRENGTH_LABEL = { off: 'Off', subtle: 'Subtle', bold: 'Bold' };
// 10% softer than the first 1.3.0 build (Yobz, 2 Nov)
const STRENGTH_ALPHA = { subtle: [0.063, 0.45], bold: [0.117, 0.765] };
const LOOP_MS = 40000;
const MAX_RECTS = 24;

const PAT_VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const PAT_FRAG = `
precision highp float;
uniform vec2 uRes;uniform float uDpr;uniform float uOff;uniform float uT;uniform vec3 uCol;uniform vec3 uMouse;
uniform float uAOut;uniform float uAIn;uniform float uMode;uniform float uRad;
uniform vec4 uRects[${MAX_RECTS}];uniform float uN;uniform vec4 uSeeds[16];uniform vec4 uSeeds2[16];
const float PI=3.14159265;
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float sdRR(vec2 p,vec4 r,float rad){vec2 c=r.xy+r.zw*.5;vec2 q=abs(p-c)-r.zw*.5+rad;return length(max(q,0.))+min(max(q.x,q.y),0.)-rad;}
float damascus(vec2 c,float ph){
  // folded: one slow smooth field bends the layers (calm like Topo, no fine noise)
  float f=sin(c.x/240.+.5*sin(ph))+.8*sin(c.y/190.-c.x/430.+.4*cos(ph))+.45*sin((c.x-c.y)/130.+ph);
  // twisted: the layers curl over themselves in slow loops
  float t=sin(c.x/115.+f*1.6)*sin(c.y/145.-f);
  // stacked layers along y; ph/PI drifts exactly 2 layers per loop, so the loop is seamless
  float w=c.y/44.+f*2.6+t*1.3+ph/PI;
  return 1.-smoothstep(.02,.11,abs(fract(w)-.5));
}
float prism(vec2 c,float ph){
  // three layers of isometric cubes, near (big, bright, fast) to far; the first cube hit hides the ones behind
  for(int L=0;L<3;L++){
    float fl=float(L);
    float s=150.-45.*fl;
    // each layer circles once per loop, the near one furthest, so they slide past each other (parallax)
    vec2 p=c+vec2(cos(ph+fl*2.1),sin(ph+fl*2.1))*(26.-8.*fl)+vec2(0.,fl*37.);
    vec2 r=vec2(1.,1.7320508)*s;vec2 h=r*.5;
    vec2 a=mod(p,r)-h;vec2 b=mod(p-h,r)-h;vec2 g=dot(a,a)<dot(b,b)?a:b;vec2 id=floor((p-g)/s*2.+.5);
    float hs=h21(id+fl*17.3);
    if(hs<.5+.12*fl)continue;
    float ir=s*.5*(.55+.4*h21(id+fl*5.1+.7))*(.93+.07*sin(ph+hs*6.2832));
    float hd=max(abs(g.x),abs(g.x)*.5+abs(g.y)*.8660254);
    if(hd>ir)continue;
    // lit top, mid left side, dark right side
    float ang=atan(-g.y,g.x);
    float shade=(ang>.5236&&ang<2.618)?.95:(g.x<0.?.6:.32);
    // thin gaps along the three near edges and the outline give the cube its shape
    float e=1e9;
    if(dot(g,vec2(.866,-.5))>0.)e=min(e,abs(g.x*.5+g.y*.866));
    if(dot(g,vec2(-.866,-.5))>0.)e=min(e,abs(g.x*.5-g.y*.866));
    if(g.y>0.)e=min(e,abs(g.x));
    // about a third are wireframes: only the edges, so the layers behind show through
    if(h21(id+fl*3.7+.2)>.66){
      float line=max(1.-smoothstep(2.,5.,e),1.-smoothstep(2.,5.,ir-hd));
      if(line<.05)continue;
      return line*.9*(1.-.28*fl);
    }
    return shade*smoothstep(1.,3.,e)*smoothstep(1.,3.,ir-hd)*(1.-.28*fl);
  }
  return 0.;
}
float lam(vec2 p,float ang,float per,float wt,float off,float ph){
  float d=p.x*cos(ang)+p.y*sin(ang),q=-p.x*sin(ang)+p.y*cos(ang);
  float wob=sin(q/61.+off)*1.4+sin(d/233.+off*2.)*3.;
  // softer lines (power 4, was 10): wide enough for the dots to show the waves
  return wt*pow(max(0.,sin(d/per+wob+ph)),4.);
}
float meteorite(vec2 c,float ph){
  float bd=1e12,b2=1e12;vec4 G=vec4(0.);vec4 H=vec4(0.);
  for(int i=0;i<16;i++){vec2 s=uSeeds[i].xy;float dd=dot(c-s,c-s);
    if(dd<bd){b2=bd;bd=dd;G=uSeeds[i];H=uSeeds2[i];}else if(dd<b2){b2=dd;}}
  float edge=sqrt(b2)-sqrt(bd);float a=G.z;
  // the lamella lines bend in slow waves that drift through each crystal
  vec2 wv=c+vec2(14.*sin(c.y/90.+ph*.5+H.x*6.2832),14.*sin(c.x/110.-ph*.5+H.y*6.2832));
  float l=max(lam(wv,a,4.6+H.x*3.,1.,H.y*9.,ph),max(lam(wv,a+PI/3.,5.+H.y*4.,.25+H.z*.6,H.x*7.,ph),lam(wv,a+2.*PI/3.,3.8+H.z*3.,.15+H.x*.5,H.z*5.,ph)))*G.w;
  // a gentle swell rolls across the whole surface (no flicker, no flashes)
  l*=.85+.25*sin((c.x*.6+c.y)/260.-ph);
  // a light that follows the mouse
  vec2 dm=c-vec2(uMouse.x,uMouse.y+uOff);
  float mg=uMouse.z*exp(-dot(dm,dm)/(2.*120.*120.));
  l=min(1.,l*(1.+mg*.55));
  // soft seams where crystals meet
  l=max(l,(1.-smoothstep(2.,7.,edge))*(.42+.14*mg));
  return l;
}
float topo(vec2 c,float ph){
  float n=sin(c.x/210.+sin(c.y/170.)*1.3+.4*sin(ph))+sin(c.y/150.-c.x/330.+.3*cos(ph))+.6*sin((c.x+c.y)/95.+ph)+.5*sin(c.x/57.-c.y/83.);
  float d=abs(fract(n*2.2)-.5);
  return 1.-smoothstep(.0,.07,d);
}
float hexmesh(vec2 p,float ph){
  float s=26.;vec2 r=vec2(1.,1.7320508);vec2 h=r*.5*s;
  vec2 a=mod(p,r*s)-h;vec2 b=mod(p-h,r*s)-h;vec2 g=dot(a,a)<dot(b,b)?a:b;vec2 id=p-g;
  vec2 q=abs(g);float e=max(dot(q,normalize(r)),q.x);float edge=1.-smoothstep(s*.40,s*.47,e);
  float rim=smoothstep(s*.36,s*.46,e);
  float fade=.35+.65*smoothstep(-.6,1.,sin(p.x/420.+p.y/360.));
  float hs=h21(floor(id/s*7.)+.5);float lit=step(.94,hs)*(.6+.4*sin(ph+hs*40.));
  return max(rim*edge*fade,lit*.8*(1.-rim));
}
float datastream(vec2 p,float ph){
  float row=floor(p.y/12.);float rh=h21(vec2(row,3.1));float dir=rh>.5?1.:-1.;
  float x=p.x+dir*ph/(2.*PI)*16.*8.*(1.+floor(rh*3.));
  float seg=floor(x/16.);float on=step(.55,h21(vec2(seg,row)));float fy=mod(p.y,12.);
  float glyph=on*step(3.,fy)*step(fy,9.)*step(2.,mod(x,16.))*step(mod(x,16.),13.);
  float bars=0.;float band=step(.86,h21(vec2(floor(p.y/96.),9.)));
  if(band>0.){float bx=floor(p.x/3.);bars=step(.5,h21(vec2(bx,floor(p.y/96.))));}
  float scan=step(mod(p.y,4.),1.)*.25;
  return max(max(glyph*(.5+.5*rh),bars*.6),scan);
}
float blackwall(vec2 p,float ph){
  float col=floor(p.x/180.);float seed=h21(vec2(col,2.7));
  float cx=(col+.5)*180.+sin(p.y/110.+ph+seed*2.*PI)*22.;
  float d=abs(p.x-cx);
  float core=exp(-d*d/18.)*(.55+.45*sin(p.y/75.+ph+seed*2.*PI));
  float mist=exp(-d*d/900.)*(.35+.65*h21(floor(p/vec2(7.,11.))));
  float row=floor(p.y/9.);
  float tear=step(.82,h21(vec2(row,col)))*exp(-d*d/2400.)*step(2.,mod(p.y,9.));
  float specks=step(.94,h21(floor(p/6.)))*exp(-d*d/1600.);
  return min(1.,core+mist*.45+tear*.8+specks*.5);
}
float blackice(vec2 p,float ph){
  float t=ph/(2.*PI);
  // rare harsh glitch: a few 14px rows jump sideways for half a second (80 steps per loop, so it still loops)
  float row=floor(p.y/14.);
  float gl=step(.985,h21(vec2(row,floor(t*80.))));
  p.x+=gl*(h21(vec2(row,1.3))-.5)*90.;
  // skewed lattice of triangular shards; g is the position inside one triangle
  vec2 q=vec2(p.x+p.y*.45,p.y*1.1)/130.;
  vec2 id=floor(q);vec2 f=fract(q);
  float up=step(f.x+f.y,1.);vec2 g=up>.5?f:1.-f;
  float hs=h21(id+up*7.7);
  float e=min(min(g.x,g.y),(1.-g.x-g.y)*.707)*130.;
  // fractures: every shard edge is a thin line, about half of them sharper
  float edge=(1.-smoothstep(.6,1.8,e))*(.18+.3*step(.5,hs));
  // about a quarter of the shards are lit facets: a slow breath, a flat gradient, blocky dropouts
  float facet=step(.72,hs)*(.12+.2*(.5+.5*sin(ph+hs*40.)))*(.4+.6*g.x)*(.55+.45*step(.35,h21(floor(p/vec2(9.,5.)))));
  // faint circuit grid with missing cells
  vec2 gm=abs(mod(p,32.)-16.);
  float grid=step(15.3,max(gm.x,gm.y))*step(.5,h21(floor(p/32.)))*.1;
  // scan sweep: a line with a trail above it moves down, twice per loop
  float s=fract(t*2.-p.y/1100.);
  float v=(edge+facet+grid)*(1.+2.2*exp(-s*14.))+(1.-smoothstep(0.,.004,s))*.35;
  v+=gl*.5*step(.4,h21(vec2(floor(p.x/22.),row)));
  // smoky falloff: wide, slowly drifting dim patches
  v*=.4+.6*smoothstep(-.6,1.,sin(p.x/420.-p.y/360.+.6*sin(ph)));
  return min(1.,v);
}
float field(vec2 c,float ph){
  if(uMode<.5)return damascus(c,ph);
  if(uMode<1.5)return meteorite(c,ph);
  if(uMode<2.5)return topo(c,ph);
  return prism(c,ph);
}
void main(){
  vec2 px=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uDpr;
  vec2 p=px+vec2(0.,uOff);
  float ph=uT*2.*PI;float a=0.;
  if(uMode<3.5){
    float g=6.;float rowH=g*.866;float r0=floor(p.y/rowH);float best=1e9;vec2 bc=vec2(0.);
    for(int k=0;k<2;k++){float rr=r0+float(k);float off=mod(rr,2.)*g*.5;vec2 cc=vec2(floor((p.x-off)/g+.5)*g+off,rr*rowH);
      float dd=distance(p,cc);if(dd<best){best=dd;bc=cc;}}
    // dots fade in as they grow instead of popping on at a size cutoff (that popping looked like glitches)
    float v=field(bc,ph);float rad=v*g*.44;a=(1.-smoothstep(rad-.6,rad+.6,best))*smoothstep(.15,.7,rad);
  } else if(uMode<4.5) a=hexmesh(p,ph);
  else if(uMode<5.5) a=datastream(p,ph);
  else if(uMode<6.5) a=blackwall(p,ph);
  else a=blackice(p,ph);
  float inside=0.;
  for(int i=0;i<${MAX_RECTS};i++){if(float(i)>=uN)break;float d=sdRR(px,uRects[i],uRad);inside=max(inside,1.-smoothstep(-1.,1.,d));}
  float al=a*mix(uAOut,uAIn,inside);
  gl_FragColor=vec4(uCol*al,al);
}`;

class PatternLayer {
  /**
   * host: element that does NOT scroll (position: relative); scroller: the
   * scrolling element inside it; cardSel: selector of the "window" cards.
   */
  constructor(plugin, host, scroller, cardSel) {
    this.plugin = plugin;
    this.host = host;
    this.scroller = scroller;
    this.cardSel = cardSel;
    this.t = 0;
    this.last = 0;
    this.raf = 0;
    this.dirty = true;
    this.canvas = host.createEl('canvas', { cls: 'nd-pattern-canvas' });
    host.prepend(this.canvas);
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
    this.gl = gl;
    if (!gl || !this.compile()) {
      this.canvas.remove();
      this.canvas = null;
      return;
    }
    this.seedMeteorite();
    this.onResize = () => {
      this.dirty = true;
      this.kick();
    };
    this.ro = new ResizeObserver(this.onResize);
    this.ro.observe(host);
    this.onScroll = () => this.kick();
    scroller.addEventListener('scroll', this.onScroll, { passive: true });
    // Cards slide in (and lift on hover), and widgets mount after the view: redraw once things settle,
    // or the cut-outs stay where the cards were mid-animation (an offset second outline behind each card
    // whenever the pattern isn't animating, e.g. right after a reload with Obsidian in the background).
    this.onSettle = () => this.kick();
    scroller.addEventListener('animationend', this.onSettle, true);
    scroller.addEventListener('transitionend', this.onSettle, true);
    this.mo = new MutationObserver((recs) => {
      const isCard = (n) => n.nodeType === 1 && (n.matches(this.cardSel) || !!n.querySelector(this.cardSel));
      if (recs.some((r) => [...r.addedNodes].some(isCard) || [...r.removedNodes].some(isCard))) this.kick();
    });
    this.mo.observe(scroller, { childList: true, subtree: true });
    // mouse light (Meteorite): position in host pixels, strength fades in and out
    this.mouse = { x: -9999, y: -9999, s: 0, at: 0 };
    this.onMove = (e) => {
      if (this.plugin.activePattern() !== 'meteorite' || prefersReducedMotion()) return;
      const r = host.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.at = performance.now();
      this.kick();
    };
    this.onLeave = () => {
      this.mouse.at = 0;
      this.kick();
    };
    host.addEventListener('mousemove', this.onMove, { passive: true });
    host.addEventListener('mouseleave', this.onLeave);
    this.onWake = () => this.kick();
    window.addEventListener('focus', this.onWake);
    window.addEventListener('blur', this.onWake);
    document.addEventListener('visibilitychange', this.onWake);
    this.unsub = plugin.onLook(() => {
      this.dirty = true;
      this.kick();
    });
    this.kick();
  }
  compile() {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('Neon Deck pattern shader', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, PAT_VERT);
    const fs = sh(gl.FRAGMENT_SHADER, PAT_FRAG);
    if (!vs || !fs) return false;
    const pr = gl.createProgram();
    gl.attachShader(pr, vs);
    gl.attachShader(pr, fs);
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return false;
    gl.useProgram(pr);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['uRes', 'uDpr', 'uOff', 'uT', 'uCol', 'uMouse', 'uAOut', 'uAIn', 'uMode', 'uRad', 'uRects', 'uN', 'uSeeds', 'uSeeds2']) this.u[n] = gl.getUniformLocation(pr, n);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }
  seedMeteorite() {
    let r = 7;
    const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    const a = [];
    const b = [];
    for (let i = 0; i < 16; i++) {
      a.push(rnd() * 1800, rnd() * 1500, rnd() * Math.PI, 0.55 + rnd() * 0.45);
      b.push(rnd(), rnd(), rnd(), 0);
    }
    this.gl.uniform4fv(this.u.uSeeds, new Float32Array(a));
    this.gl.uniform4fv(this.u.uSeeds2, new Float32Array(b));
  }
  look() {
    const s = this.plugin.settings;
    const pattern = this.plugin.activePattern();
    const strength = s.patternStrength;
    return { pattern, strength, on: pattern !== 'none' && strength !== 'off' };
  }
  animating() {
    const s = this.plugin.settings;
    return (
      s.patternMotion &&
      !prefersReducedMotion() &&
      document.visibilityState === 'visible' &&
      document.hasFocus() &&
      this.host.isConnected &&
      this.host.offsetParent !== null
    );
  }
  kick() {
    if (!this.canvas || this.raf) return;
    this.raf = window.requestAnimationFrame((now) => this.frame(now));
  }
  frame(now) {
    this.raf = 0;
    if (!this.canvas || !this.host.isConnected) return;
    const anim = this.animating();
    if (anim) {
      if (this.last) this.t = (this.t + (now - this.last) / LOOP_MS) % 1;
      this.last = now;
    } else this.last = 0;
    // ease the mouse light toward on (moved in the last 0.7 s) or off
    const m = this.mouse;
    const target = m && m.at && now - m.at < 700 ? 1 : 0;
    if (m) m.s += (target - m.s) * 0.2;
    const fading = m && Math.abs(target - m.s) > 0.01;
    if (m && !fading) m.s = target;
    this.draw();
    // ~20 fps is plenty for a 40 s loop; idle views draw only on change.
    // Only one timer at a time: extra kicks (scroll, mouse) must not start extra loops.
    if ((anim || fading) && !this.timer) {
      this.timer = window.setTimeout(() => {
        this.timer = 0;
        this.kick();
      }, anim ? 50 : 33);
    }
  }
  draw() {
    const lk = this.look();
    // only touch the classes when on/off changes: setting them every frame made the page restyle ~20×/s
    if (this.shownOn !== lk.on) {
      this.shownOn = lk.on;
      this.canvas.toggleClass('is-hidden', !lk.on);
      this.host.toggleClass('nd-has-pattern', lk.on);
    }
    if (!lk.on) return;
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const W = this.host.clientWidth;
    const H = this.host.clientHeight;
    if (!W || !H) return;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    if (this.dirty) {
      const cs = getComputedStyle(this.host);
      this.col = parseColor(cs.getPropertyValue('--nd-pattern').trim() || '#e5506a');
      this.radius = parseFloat(cs.getPropertyValue('--nd-radius')) || 22;
      this.dirty = false;
    }
    const hr = this.host.getBoundingClientRect();
    const rects = [];
    for (const el of this.scroller.querySelectorAll(this.cardSel)) {
      const r = el.getBoundingClientRect();
      if (r.bottom < hr.top || r.top > hr.bottom || !r.width) continue;
      rects.push(r.left - hr.left, r.top - hr.top, r.width, r.height);
      if (rects.length >= MAX_RECTS * 4) break;
    }
    const n = rects.length / 4;
    this.lastRects = rects.slice(); // what the cut-outs were drawn from (handy when checking alignment)
    while (rects.length < MAX_RECTS * 4) rects.push(0, 0, 0, 0);
    const [aOut, aIn] = STRENGTH_ALPHA[lk.strength] || STRENGTH_ALPHA.subtle;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.uDpr, dpr);
    gl.uniform1f(this.u.uOff, this.scroller.scrollTop);
    gl.uniform1f(this.u.uT, this.t);
    gl.uniform3f(this.u.uCol, ...this.col);
    gl.uniform3f(this.u.uMouse, this.mouse ? this.mouse.x : -9999, this.mouse ? this.mouse.y : -9999, this.mouse ? this.mouse.s : 0);
    gl.uniform1f(this.u.uAOut, aOut);
    gl.uniform1f(this.u.uAIn, aIn);
    gl.uniform1f(this.u.uMode, PATTERN_MODE[lk.pattern] || 0);
    gl.uniform1f(this.u.uRad, this.radius);
    gl.uniform4fv(this.u.uRects, new Float32Array(rects));
    gl.uniform1f(this.u.uN, n);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  destroy() {
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.clearTimeout(this.timer);
    this.timer = 0;
    if (this.ro) this.ro.disconnect();
    if (this.scroller && this.onScroll) this.scroller.removeEventListener('scroll', this.onScroll);
    if (this.scroller && this.onSettle) {
      this.scroller.removeEventListener('animationend', this.onSettle, true);
      this.scroller.removeEventListener('transitionend', this.onSettle, true);
    }
    if (this.mo) this.mo.disconnect();
    if (this.onMove) this.host.removeEventListener('mousemove', this.onMove);
    if (this.onLeave) this.host.removeEventListener('mouseleave', this.onLeave);
    window.removeEventListener('focus', this.onWake);
    window.removeEventListener('blur', this.onWake);
    document.removeEventListener('visibilitychange', this.onWake);
    if (this.unsub) this.unsub();
    if (this.gl) {
      const ext = this.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
    if (this.canvas) this.canvas.remove();
    this.canvas = null;
  }
}
/** CSS colour -> [r,g,b] in 0..1 */
function parseColor(str) {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = '#000';
  c.fillStyle = str;
  const v = c.fillStyle;
  if (v.startsWith('#')) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const m = v.match(/[\d.]+/g) || [0, 0, 0];
  return m.slice(0, 3).map((x) => Number(x) / 255);
}

