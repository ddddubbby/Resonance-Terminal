import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLUSTERING_ARTIFACT_VERSION,
  type Cluster,
  type ClusterArtifact,
  ClusterStoreError,
  clusterDocuments,
  clustersPath,
  crossSourceShare,
  DEFAULT_CLUSTERING_CONFIG,
  makeDocument,
  readClusters,
  type SourceDocument,
  tokenize,
  writeClusters,
} from "../src/index.js";

const CAPTURED_AT = "2026-08-27T00:00:00.000Z";
const STOPWORDS = new Set(DEFAULT_CLUSTERING_CONFIG.stopwords);

function doc(
  sourceId: string,
  title: string,
  text: string,
  kind: SourceDocument["kind"] = "news",
): SourceDocument {
  return makeDocument(
    {
      sourceId,
      kind,
      url: `https://example.invalid/${sourceId}/${title.replace(/\W+/g, "-")}`,
      title,
      text,
    },
    CAPTURED_AT,
    { publishedAt: CAPTURED_AT },
  );
}

function freshRunDir(): string {
  return mkdtempSync(join(tmpdir(), "resonance-clusters-"));
}

function expectClusterError(fn: () => unknown, code: ClusterStoreError["code"]): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ClusterStoreError);
    expect((error as ClusterStoreError).code).toBe(code);
    return;
  }
  expect.fail(`expected ClusterStoreError with code "${code}"`);
}

describe("tokenize", () => {
  it("drops stopwords and short tokens, buckets addresses and digits", () => {
    const tokens = tokenize(
      "The protocol at 0xabcdef123456 moved 500000 usd in 2026 very fast",
      STOPWORDS,
    );
    expect(tokens).toContain("protocol");
    expect(tokens).toContain("address");
    expect(tokens).toContain("number");
    expect(tokens).not.toContain("500000");
    expect(tokens).not.toContain("2026");
    expect(tokens).not.toContain("usd");
    expect(tokens).not.toContain("very");
  });
});

describe("clusterDocuments", () => {
  it("is deterministic for a fixed corpus and configuration", () => {
    const corpus = [
      doc("rss-alpha", "Clarity act passes senate", "clarity act senate vote passes crypto bill"),
      doc("rss-beta", "Senate passes clarity act", "senate passes clarity act crypto bill today"),
      doc("rss-alpha", "Exchange lists new token", "exchange lists new token trading pair launch"),
    ];
    const first = clusterDocuments(corpus);
    const second = clusterDocuments(corpus);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("clusters near-duplicate reports across sources", () => {
    const corpus = [
      doc("rss-alpha", "Clarity act passes senate", "clarity act senate vote passes crypto bill"),
      doc("rss-beta", "Senate passes clarity act", "senate passes clarity act crypto bill today"),
    ];
    const clusters = clusterDocuments(corpus, { ...DEFAULT_CLUSTERING_CONFIG, threshold: 0.3 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.size).toBe(2);
    expect(clusters[0]?.clusterId).toBe("c000");
    const sources = clusters[0]?.docs.map((d) => d.sourceId).sort();
    expect(sources).toEqual(["rss-alpha", "rss-beta"]);
  });

  it("keeps a barely-overlapping document as its own cluster", () => {
    // A and B are identical; C shares exactly one of five terms. Correct
    // cosine against the true mean direction is ~0.10, below 0.25 — the
    // spike's inflated-centroid dot product would have been higher.
    const corpus = [
      doc("s1", "Alpha story", "alpha beta gamma delta epsilon"),
      doc("s1", "Alpha story again", "alpha beta gamma delta epsilon"),
      doc("s2", "Other story", "alpha omega sigma theta kappa"),
    ];
    const clusters = clusterDocuments(corpus, { ...DEFAULT_CLUSTERING_CONFIG, threshold: 0.25 });
    expect(clusters.map((c) => c.size)).toEqual([2, 1]);
  });

  it("clusters only the configured kinds", () => {
    const corpus = [
      doc("binance-spot", "BTC mover row", "btc usdt percent change volume", "mover"),
      doc("defillama", "TVL row", "protocol tvl chain category", "tvl"),
      doc("rss-alpha", "Real story", "clarity act senate vote passes"),
    ];
    const clusters = clusterDocuments(corpus);
    const members = clusters.flatMap((c) => c.docs);
    expect(members).toHaveLength(1);
    expect(members[0]?.kind).toBe("news");
  });

  it("never emits pure-digit top terms", () => {
    const corpus = [
      doc("s1", "Fund raise 500000", "fund raised 500000 tokens 123456 round seed"),
      doc("s2", "Fund raise 900000", "fund raised 900000 tokens 654321 round seed"),
    ];
    const [cluster] = clusterDocuments(corpus, { ...DEFAULT_CLUSTERING_CONFIG, threshold: 0.2 });
    for (const term of cluster?.topTerms ?? []) {
      expect(term).not.toMatch(/^[0-9]/);
    }
  });

  it("sorts clusters by size and assigns run-local ids", () => {
    const corpus = [
      doc("s1", "Event one a", "merger acquisition deal announced board"),
      doc("s2", "Event one b", "merger acquisition deal approved board"),
      doc("s3", "Event two", "exploit drained funds bridge protocol"),
    ];
    const clusters = clusterDocuments(corpus, { ...DEFAULT_CLUSTERING_CONFIG, threshold: 0.3 });
    expect(clusters.map((c) => c.clusterId)).toEqual(["c000", "c001"]);
    expect(clusters[0]?.size).toBeGreaterThanOrEqual(clusters[1]?.size ?? 0);
  });

  it("returns no clusters for an empty or fully-structured corpus", () => {
    expect(clusterDocuments([])).toEqual([]);
    expect(clusterDocuments([doc("binance-spot", "row", "btc usdt", "market")])).toEqual([]);
  });
});

describe("crossSourceShare", () => {
  function cluster(sourceIds: string[], size?: number): Cluster {
    const n = size ?? sourceIds.length;
    return {
      clusterId: "c000",
      topTerms: [],
      size: n,
      docs: sourceIds.map((sourceId, i) => ({
        docId: `doc${i}aaaaaaaa`,
        sourceId,
        kind: "news" as const,
        title: `t${i}`,
        url: `https://example.invalid/${i}`,
      })),
    };
  }

  it("reports zero for empty input", () => {
    expect(crossSourceShare([])).toEqual({
      clusters: 0,
      multiDoc: 0,
      crossSource: 0,
      shareOfMulti: 0,
      shareOfAll: 0,
    });
  });

  it("measures the share of convergent clusters", () => {
    const report = crossSourceShare([
      cluster(["a", "b", "c"]),
      cluster(["a", "a"]),
      cluster(["x"]),
      cluster(["y"]),
    ]);
    expect(report).toEqual({
      clusters: 4,
      multiDoc: 2,
      crossSource: 1,
      shareOfMulti: 0.5,
      shareOfAll: 0.25,
    });
  });
});

describe("cluster artifact persistence", () => {
  function artifact(): ClusterArtifact {
    return {
      schemaVersion: CLUSTERING_ARTIFACT_VERSION,
      runId: "2026-08-27T00-00-00",
      createdAt: CAPTURED_AT,
      config: DEFAULT_CLUSTERING_CONFIG,
      clusters: clusterDocuments([
        doc("rss-alpha", "Clarity act passes", "clarity act senate vote passes bill"),
        doc("rss-beta", "Senate passes act", "senate passes clarity act bill today"),
      ]),
    };
  }

  it("writes clusters.json next to the snapshot and reads it back", () => {
    const runDir = freshRunDir();
    const path = writeClusters(runDir, artifact());
    expect(path).toBe(clustersPath(runDir));
    expect(readClusters(runDir)).toEqual(artifact());
  });

  it("refuses to overwrite an existing artifact", () => {
    const runDir = freshRunDir();
    writeClusters(runDir, artifact());
    expectClusterError(() => writeClusters(runDir, artifact()), "clusters-exist");
  });

  it("serializes deterministically", () => {
    const dirA = freshRunDir();
    const dirB = freshRunDir();
    writeClusters(dirA, artifact());
    writeClusters(dirB, artifact());
    expect(readFileSync(clustersPath(dirA), "utf8")).toBe(readFileSync(clustersPath(dirB), "utf8"));
  });

  it("embeds the versioned configuration used", () => {
    const runDir = freshRunDir();
    writeClusters(runDir, artifact());
    const read = readClusters(runDir);
    expect(read?.config).toEqual(DEFAULT_CLUSTERING_CONFIG);
    expect(read?.config.configVersion).toBe("1");
  });

  it("returns null when no artifact exists", () => {
    expect(readClusters(freshRunDir())).toBeNull();
  });
});
