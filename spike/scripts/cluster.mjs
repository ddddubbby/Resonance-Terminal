#!/usr/bin/env node
// Spike clustering — prototype quality by design.
// Deterministic: tokenization, stop-word removal, TF-IDF vectors, brute-force
// cosine similarity, greedy clustering. Reads the latest snapshot and writes
// clusters.json next to it. The agent (not this code) names the clusters.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dataDir = join(process.cwd(), "spike", "data");
const snapsRoot = join(dataDir, "snapshots");
const runs = readdirSync(snapsRoot).sort();
const runId = runs[runs.length - 1];
const snapDir = join(snapsRoot, runId);
const docs = readFileSync(join(snapDir, "docs.ndjson"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

const STOPWORDS = new Set(
  (
    "a an and are as at be but by for from has have how in into is it its may more new of on or " +
    "our over said says than that the their there these they this to was were what when where " +
    "which who will with you your we us not no can could would should after before between during " +
    "up down out about against because under again further then once here all any both each few " +
    "other some such only own same so too very s t just don now also via using use used per " +
    "percent billion million usd usdt crypto crypto news price data"
  ).split(" "),
);

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map((t) => t.replace(/^0x[0-9a-f]+$/, "address") || t);
}

const tokens = docs.map((d) => tokenize(`${d.title} ${d.text}`));
const df = new Map();
for (const toks of tokens) {
  for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
}
const N = docs.length;
const idf = (t) => Math.log(1 + N / (1 + (df.get(t) ?? 0)));

const vectors = tokens.map((toks) => {
  const tf = new Map();
  for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
  const vec = new Map();
  let norm = 0;
  for (const [t, count] of tf) {
    const w = (1 + Math.log(count)) * idf(t);
    vec.set(t, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of vec) vec.set(t, w / norm);
  return vec;
});

function cosine(a, b) {
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const w2 = big.get(t);
    if (w2 !== undefined) dot += w * w2;
  }
  return dot;
}

// Greedy clustering: each doc joins the first existing cluster whose centroid
// similarity exceeds the threshold; otherwise it starts a new cluster.
const THRESHOLD = 0.18;
const clusters = []; // { docIdx: [], centroid: Map }
for (let i = 0; i < N; i++) {
  let best = -1;
  let bestSim = 0;
  for (let c = 0; c < clusters.length; c++) {
    const sim = cosine(vectors[i], clusters[c].centroid);
    if (sim > bestSim) {
      bestSim = sim;
      best = c;
    }
  }
  if (best >= 0 && bestSim >= THRESHOLD) {
    clusters[best].docIdx.push(i);
    const c = clusters[best];
    const k = c.docIdx.length;
    for (const [t, w] of vectors[i])
      c.centroid.set(t, ((c.centroid.get(t) ?? 0) * (k - 1) + w) / k);
  } else {
    clusters.push({ docIdx: [i], centroid: new Map(vectors[i]) });
  }
}

const out = clusters
  .map((c, idx) => {
    const terms = [...c.centroid.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([t]) => t);
    return {
      clusterId: `c${String(idx).padStart(3, "0")}`,
      size: c.docIdx.length,
      topTerms: terms,
      docs: c.docIdx.map((i) => ({
        docId: docs[i].docId,
        sourceId: docs[i].sourceId,
        kind: docs[i].kind,
        title: docs[i].title,
        url: docs[i].url,
        publishedAt: docs[i].publishedAt,
      })),
    };
  })
  .sort((a, b) => b.size - a.size);

writeFileSync(
  join(snapDir, "clusters.json"),
  JSON.stringify({ runId, threshold: THRESHOLD, clusters: out }, null, 2),
);

console.log(`runId: ${runId}`);
console.log(`docs: ${N}, clusters: ${out.length}`);
for (const c of out.slice(0, 15)) {
  console.log(
    `${c.clusterId} n=${String(c.size).padStart(3)} ${c.topTerms.slice(0, 6).join(", ")}`,
  );
}
