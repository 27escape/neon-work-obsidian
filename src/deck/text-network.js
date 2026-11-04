/* ------------------------------------------------------------------ */
/* Text network analysis (InfraNodus-style)                            */
/* ------------------------------------------------------------------ */

const STOPWORDS = (
  // English
  'a about above after again against all almost also although always am among an and another any anybody anyone anything anyway anywhere are aren around as at ' +
  'back be became because become becomes been before being below between both but by can cannot could couldn did didn do does doesn doing don done down during ' +
  'each either else enough even ever every everyone everything few for from further get gets getting give given go goes going gone got had hadn has hasn have haven having he her here hers herself him himself his how however ' +
  'i if in into is isn it its itself just keep know last least less let like likely made make makes many may maybe me might mine more most mostly much must my myself ' +
  'need needs neither never new next no nobody none nor not nothing now of off often oh ok okay on once one only onto or other others otherwise our ours ourselves out over own ' +
  'per perhaps put quite rather really said same say says see seem seemed seems several shall she should shouldn show since so some somebody someone something sometimes somewhat still such sure ' +
  'take than that the their theirs them themselves then there therefore these they thing things think this those though through thus to together too toward towards ' +
  'under until up upon us use used uses using very via want wants was wasn way ways we well were weren what whatever when where whether which while who whoever whole whom whose why will with within without won would wouldn ' +
  'yes yet you your yours yourself yourselves etc vs eg ie also lot lots kind sort bit thing stuff today tomorrow yesterday ' +
  // German
  'aber alle allem allen aller alles als also am an ander andere anderen auch auf aus bei bin bis bist da damit dann das dass dein deine dem den denn der des dich die dies diese diesem diesen dieser dir doch dort du durch ' +
  'ein eine einem einen einer eines er es etwas euch euer für gegen hab habe haben hat hatte ich ihm ihn ihr ihre im in ist ja jede jedem jeden jeder jedes jetzt kann kein keine man mehr mein meine mich mir mit muss nach nicht nichts noch nun nur ob oder ohne schon sehr sein seine sich sie sind so solche soll sondern sonst über um und uns unser unter viel vom von vor war waren warum was weil weiter welche wenn wer werden wie wieder will wir wird wo wurde zu zum zur zwar zwischen ' +
  // Markdown / web noise
  'http https www com org net html png jpg jpeg gif pdf md tags tag aliases cssclasses created updated'
).split(/\s+/);

const TOKEN_RE = /⟦[^⟧]+⟧|#[\p{L}\p{N}_\/-]+|[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;

function lemma(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (/(ss|us|is)$/.test(w)) return w;
  if (w.length > 4 && /(xes|ches|shes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 5 && w.endsWith('oes')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}
function cleanForConcepts(text) {
  return stripFrontmatter(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/%%[\s\S]*?%%/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g, (_, t) => ` ⟦${t.trim().toLowerCase()}⟧ `)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}
function tokenize(line, stop) {
  const out = [];
  const m = line.toLowerCase().match(TOKEN_RE);
  if (!m) return out;
  for (let t of m) {
    if (t[0] === '⟦' || t[0] === '#') {
      if (t.length > 2) out.push(t);
      continue;
    }
    t = t.replace(/['’]s$/, '').replace(/['’_-]+$/, '');
    if (t.length < 3 || /^[\d_-]+$/.test(t) || stop.has(t)) continue;
    t = lemma(t);
    if (!stop.has(t)) out.push(t);
  }
  return out;
}
function conceptLabel(key) {
  return key[0] === '⟦' ? `[[${key.slice(1, -1)}]]` : key;
}
function conceptKind(key) {
  return key[0] === '⟦' ? 'link' : key[0] === '#' ? 'tag' : 'word';
}

function buildConceptNetwork(docs, { window = 4, maxNodes = 120, stopwords }) {
  const freq = new Map();
  const wdeg = new Map();
  const pairs = new Map();
  const where = new Map();
  for (const doc of docs) {
    for (const line of cleanForConcepts(doc.text).split('\n')) {
      const toks = tokenize(line, stopwords);
      for (let i = 0; i < toks.length; i++) {
        const w = toks[i];
        freq.set(w, (freq.get(w) || 0) + 1);
        let s = where.get(w);
        if (!s) where.set(w, (s = new Set()));
        s.add(doc.path);
        for (let d = 1; d < window && i + d < toks.length; d++) {
          const u = toks[i + d];
          if (u === w) continue;
          const key = w < u ? w + '\u0001' + u : u + '\u0001' + w;
          const wt = window - d;
          pairs.set(key, (pairs.get(key) || 0) + wt);
          wdeg.set(w, (wdeg.get(w) || 0) + wt);
          wdeg.set(u, (wdeg.get(u) || 0) + wt);
        }
      }
    }
  }
  const ranked = [...wdeg.keys()]
    .sort((a, b) => wdeg.get(b) - wdeg.get(a) || freq.get(b) - freq.get(a) || (a < b ? -1 : 1))
    .slice(0, maxNodes);
  const index = new Map(ranked.map((w, i) => [w, i]));
  const raw = [];
  for (const [key, w] of pairs) {
    const [a, b] = key.split('\u0001');
    const ia = index.get(a);
    const ib = index.get(b);
    if (ia !== undefined && ib !== undefined) raw.push([ia, ib, w]);
  }
  const has = new Uint8Array(ranked.length);
  for (const [a, b] of raw) has[a] = has[b] = 1;
  const keep = ranked.map((_, i) => i).filter((i) => has[i]);
  const re = new Map(keep.map((old, i) => [old, i]));
  const keys = keep.map((i) => ranked[i]);
  return {
    keys,
    labels: keys.map(conceptLabel),
    kinds: keys.map(conceptKind),
    edges: raw.map(([a, b, w]) => [re.get(a), re.get(b), w]),
    freq: keys.map((k) => freq.get(k)),
    where: keys.map((k) => [...where.get(k)]),
  };
}

function buildNoteNetwork(app, files, maxNodes) {
  const idx = new Map(files.map((f, i) => [f.path, i]));
  const pair = new Map();
  const deg = new Float64Array(files.length);
  const rl = app.metadataCache.resolvedLinks;
  for (const f of files) {
    const out = rl[f.path];
    if (!out) continue;
    const a = idx.get(f.path);
    for (const [dst, c] of Object.entries(out)) {
      const b = idx.get(dst);
      if (b === undefined || b === a) continue;
      const key = Math.min(a, b) * 1e6 + Math.max(a, b);
      pair.set(key, (pair.get(key) || 0) + c);
      deg[a] += c;
      deg[b] += c;
    }
  }
  const order = files.map((_, i) => i).filter((i) => deg[i] > 0).sort((a, b) => deg[b] - deg[a]).slice(0, maxNodes);
  const re = new Map(order.map((old, i) => [old, i]));
  const edges = [];
  for (const [key, w] of pair) {
    const a = re.get(Math.floor(key / 1e6));
    const b = re.get(key % 1e6);
    if (a !== undefined && b !== undefined) edges.push([a, b, w]);
  }
  const picked = order.map((i) => files[i]);
  return {
    keys: picked.map((f) => f.path),
    labels: picked.map((f) => f.basename),
    kinds: picked.map(() => 'note'),
    files: picked,
    edges,
  };
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function louvainLevel(n, edges, rand) {
  const adj = Array.from({ length: n }, () => []);
  const k = new Float64Array(n);
  let m2 = 0;
  for (const [a, b, w] of edges) {
    if (a === b) {
      k[a] += 2 * w;
      m2 += 2 * w;
      continue;
    }
    adj[a].push(b, w);
    adj[b].push(a, w);
    k[a] += w;
    k[b] += w;
    m2 += 2 * w;
  }
  const comm = Int32Array.from({ length: n }, (_, i) => i);
  if (m2 === 0) return { comm, moved: false };
  const tot = Float64Array.from(k);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let movedAny = false;
  const kin = new Map();
  for (let pass = 0; pass < 30; pass++) {
    let moved = 0;
    for (const i of order) {
      const ci = comm[i];
      kin.clear();
      const a = adj[i];
      for (let x = 0; x < a.length; x += 2) {
        const c = comm[a[x]];
        kin.set(c, (kin.get(c) || 0) + a[x + 1]);
      }
      tot[ci] -= k[i];
      let best = ci;
      let bestGain = (kin.get(ci) || 0) - (tot[ci] * k[i]) / m2;
      for (const [c, w] of kin) {
        const g = w - (tot[c] * k[i]) / m2;
        if (g > bestGain + 1e-12) {
          bestGain = g;
          best = c;
        }
      }
      tot[best] += k[i];
      if (best !== ci) {
        comm[i] = best;
        moved++;
      }
    }
    if (!moved) break;
    movedAny = true;
  }
  return { comm, moved: movedAny };
}

function louvain(n, edges, seed = 7) {
  const rand = mulberry32(seed);
  let membership = Array.from({ length: n }, (_, i) => i);
  let curN = n;
  let curEdges = edges;
  for (let level = 0; level < 12; level++) {
    const { comm, moved } = louvainLevel(curN, curEdges, rand);
    if (!moved) break;
    const remap = new Map();
    for (let i = 0; i < curN; i++) if (!remap.has(comm[i])) remap.set(comm[i], remap.size);
    membership = membership.map((c) => remap.get(comm[c]));
    const agg = new Map();
    for (const [a, b, w] of curEdges) {
      let x = remap.get(comm[a]);
      let y = remap.get(comm[b]);
      if (x > y) [x, y] = [y, x];
      const key = x * 1e6 + y;
      agg.set(key, (agg.get(key) || 0) + w);
    }
    curEdges = [...agg].map(([key, w]) => [Math.floor(key / 1e6), key % 1e6, w]);
    curN = remap.size;
  }
  return membership;
}

function modularity(edges, comm) {
  const tot = new Map();
  let m2 = 0;
  let inside = 0;
  for (const [a, b, w] of edges) {
    m2 += 2 * w;
    tot.set(comm[a], (tot.get(comm[a]) || 0) + w);
    tot.set(comm[b], (tot.get(comm[b]) || 0) + w);
    if (comm[a] === comm[b]) inside += 2 * w;
  }
  if (!m2) return 0;
  let q = inside / m2;
  for (const t of tot.values()) q -= (t / m2) ** 2;
  return q;
}

function betweenness(n, adj) {
  const bc = new Float64Array(n);
  const sigma = new Float64Array(n);
  const dist = new Int32Array(n);
  const delta = new Float64Array(n);
  const preds = Array.from({ length: n }, () => []);
  const stack = new Int32Array(n);
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    let sp = 0;
    let qh = 0;
    let qt = 0;
    for (let i = 0; i < n; i++) {
      preds[i].length = 0;
      sigma[i] = 0;
      dist[i] = -1;
      delta[i] = 0;
    }
    sigma[s] = 1;
    dist[s] = 0;
    queue[qt++] = s;
    while (qh < qt) {
      const v = queue[qh++];
      stack[sp++] = v;
      for (const w of adj[v]) {
        if (dist[w] < 0) {
          dist[w] = dist[v] + 1;
          queue[qt++] = w;
        }
        if (dist[w] === dist[v] + 1) {
          sigma[w] += sigma[v];
          preds[w].push(v);
        }
      }
    }
    while (sp > 0) {
      const w = stack[--sp];
      for (const v of preds[w]) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      if (w !== s) bc[w] += delta[w];
    }
  }
  return bc;
}

const DIVERSITY_HINT = {
  Biased: 'One idea dominates. Great for depth — try adding a contrasting perspective.',
  Focused: 'A clear core with supporting themes. Healthy balance, room to branch out.',
  Diversified: 'Several distinct topics that still connect. Ideal for creative thinking.',
  Dispersed: 'Many loosely linked islands. Look at the gaps and build bridges.',
};

function analyzeNetwork(n, edges) {
  const comm = louvain(n, edges);
  const adj = Array.from({ length: n }, () => []);
  const deg = new Float64Array(n);
  for (const [a, b, w] of edges) {
    if (a === b) continue;
    adj[a].push(b);
    adj[b].push(a);
    deg[a] += w;
    deg[b] += w;
  }
  const bc = betweenness(n, adj);
  let maxBc = 1e-9;
  let maxDeg = 1e-9;
  for (let i = 0; i < n; i++) {
    maxBc = Math.max(maxBc, bc[i]);
    maxDeg = Math.max(maxDeg, deg[i]);
  }
  const score = Array.from({ length: n }, (_, i) => 0.75 * Math.sqrt(bc[i] / maxBc) + 0.25 * Math.sqrt(deg[i] / maxDeg));

  const groups = new Map();
  comm.forEach((c, i) => {
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(i);
  });
  const topics = [...groups.values()]
    .map((members) => {
      members.sort((a, b) => score[b] - score[a]);
      return { members, weight: members.reduce((s, i) => s + score[i], 0) };
    })
    .sort((a, b) => b.weight - a.weight);
  const cid = new Int32Array(n);
  topics.forEach((t, k) => {
    t.id = k;
    t.share = t.members.length / n;
    for (const i of t.members) cid[i] = k;
  });
  const Q = modularity(edges, cid);

  const cross = new Map();
  for (const [a, b, w] of edges) {
    const x = cid[a];
    const y = cid[b];
    if (x === y) continue;
    const key = Math.min(x, y) * 1000 + Math.max(x, y);
    cross.set(key, (cross.get(key) || 0) + w);
  }
  const big = topics.filter((t) => t.members.length >= 3).slice(0, 6);
  const gaps = [];
  for (let i = 0; i < big.length; i++) {
    for (let j = i + 1; j < big.length; j++) {
      const A = big[i];
      const B = big[j];
      const w = cross.get(Math.min(A.id, B.id) * 1000 + Math.max(A.id, B.id)) || 0;
      gaps.push({ a: A.id, b: B.id, weight: w, density: w / (A.members.length * B.members.length) });
    }
  }
  gaps.sort((x, y) => x.density - y.density || x.a + x.b - (y.a + y.b));

  const topShare = topics[0] ? topics[0].share : 1;
  let diversity;
  if (Q >= 0.65) diversity = 'Dispersed';
  else if (Q >= 0.4) diversity = 'Diversified';
  else if (Q >= 0.2 && topShare < 0.5) diversity = 'Focused';
  else diversity = 'Biased';

  return { comm: cid, bc, deg, score, adj, topics, gaps: gaps.slice(0, 3), Q, diversity };
}

