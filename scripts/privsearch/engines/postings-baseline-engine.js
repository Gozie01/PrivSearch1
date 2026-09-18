const { performance } = require('perf_hooks');
const {
  collectKeywords,
  loadKeywordPostings,
  intersectPostingLists,
  unionPostingLists,
} = require('../workload-lib');
const {
  buildSemanticTermWeights,
  rankSemanticCandidates,
} = require('../semantic-lib');

class PostingsBaselineEngine {
  constructor(options = {}) {
    this.name = 'postings-baseline';
    this.indexRoot = options.indexRoot;
    this.postings = new Map();
  }

  async prepare(workloads) {
    const keywords = collectKeywords(workloads);
    this.postings = await loadKeywordPostings(keywords, { indexRoot: this.indexRoot });
  }

  getEntries(keywords) {
    return keywords.map((keyword) => {
      const entry = this.postings.get(keyword);
      if (!entry) {
        throw new Error(`Missing postings for keyword "${keyword}"`);
      }
      return entry;
    });
  }

  async runQuery(query) {
    const setupStart = performance.now();
    let phaseHints = {};

    if (query.query_type === 'single_keyword') {
      phaseHints = { mode: 'single' };
    } else if (query.query_type.startsWith('and_')) {
      phaseHints = { mode: 'conjunctive', clauseCount: (query.keywords || []).length };
    } else if (query.query_type.startsWith('or_')) {
      phaseHints = { mode: 'disjunctive', clauseCount: (query.keywords || []).length || 2 };
    } else if (query.query_type === 'semantic_v1') {
      phaseHints = {
        mode: 'semantic_v1',
        termCount: (query.matched_keywords || query.keywords || []).length,
        topK: Number(query.semantic_top_k || query.expected_result_count || 10),
      };
    }

    const setupMs = performance.now() - setupStart;

    const searchStart = performance.now();
    let resultDocs = [];

    if (query.query_type === 'single_keyword') {
      resultDocs = this.getEntries(query.keywords)[0].postings.slice();
    } else if (query.query_type.startsWith('and_')) {
      resultDocs = intersectPostingLists(this.getEntries(query.keywords));
    } else if (query.query_type === 'or_2' || query.query_type === 'or_3') {
      resultDocs = unionPostingLists(this.getEntries(query.keywords));
    } else if (query.query_type === 'or_of_and') {
      const leftDocs = intersectPostingLists(this.getEntries(query.clause_1_keywords));
      const rightDocs = intersectPostingLists(this.getEntries(query.clause_2_keywords));
      resultDocs = [...new Set([...leftDocs, ...rightDocs])];
      phaseHints = {
        mode: 'dnf',
        clauseCount: 2,
        clauseResultSizes: [leftDocs.length, rightDocs.length],
      };
    } else if (query.query_type === 'semantic_v1') {
      const semanticKeywords = [...new Set(query.matched_keywords || query.keywords || [])];
      const ranking = rankSemanticCandidates(
        this.getEntries(semanticKeywords).map((entry) => ({
          keyword: entry.keyword,
          postings: entry.postings,
          doc_freq: entry.doc_freq,
        })),
        buildSemanticTermWeights(query),
        Number(query.semantic_top_k || query.expected_result_count || 10),
      );
      resultDocs = ranking.ranked_docs.map((row) => row.doc_id);
      phaseHints = {
        mode: 'semantic_v1',
        termCount: semanticKeywords.length,
        candidateCount: ranking.candidate_count,
        topK: Number(query.semantic_top_k || query.expected_result_count || 10),
      };
    } else {
      throw new Error(`Unsupported query type ${query.query_type}`);
    }

    const searchMs = performance.now() - searchStart;

    const verifyStart = performance.now();
    const verified = resultDocs.length === query.expected_result_count;
    const verifyMs = performance.now() - verifyStart;

    return {
      setup_ms: setupMs,
      search_ms: searchMs,
      verify_ms: verifyMs,
      total_ms: setupMs + searchMs + verifyMs,
      result_count: resultDocs.length,
      verified,
      phase_hints: phaseHints,
      verification_mode: 'count-check-baseline',
    };
  }
}

module.exports = { PostingsBaselineEngine };
