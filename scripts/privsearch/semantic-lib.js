const DEFAULT_SEMANTIC_TOP_K = Number(process.env.PRIVSEARCH_SEMANTIC_TOP_K || '10');
const PRIMARY_TERM_WEIGHT = Number(process.env.PRIVSEARCH_SEMANTIC_PRIMARY_WEIGHT || '1.0');
const EXPANSION_TERM_WEIGHT = Number(process.env.PRIVSEARCH_SEMANTIC_EXPANSION_WEIGHT || '0.65');

const SEMANTIC_CONCEPTS = [
  {
    concept_id: 'energy_contracts',
    query_text: 'energy contract pricing and forward gas supply',
    primary_terms: ['energy', 'contract', 'pricing', 'gas'],
    expansion_terms: ['power', 'forward', 'deal', 'supply', 'price', 'terms'],
  },
  {
    concept_id: 'power_generation',
    query_text: 'power generation turbine electricity and gas operations',
    primary_terms: ['power', 'generation', 'turbine', 'electricity'],
    expansion_terms: ['gas', 'energy', 'operations', 'supply'],
  },
  {
    concept_id: 'internet_access',
    query_text: 'internet access login dns and network setup',
    primary_terms: ['internet', 'access', 'login', 'network'],
    expansion_terms: ['dns', 'static', 'server', 'password'],
  },
  {
    concept_id: 'trading_risk',
    query_text: 'trading risk market exposure and hedge strategy',
    primary_terms: ['trading', 'risk', 'market', 'hedge'],
    expansion_terms: ['exposure', 'deal', 'price', 'forward'],
  },
  {
    concept_id: 'customer_support',
    query_text: 'customer service request support issue resolution',
    primary_terms: ['customer', 'service', 'support', 'request'],
    expansion_terms: ['issue', 'help', 'problem', 'response'],
  },
  {
    concept_id: 'meeting_coordination',
    query_text: 'meeting conference call discussion and schedule',
    primary_terms: ['meeting', 'conference', 'call', 'schedule'],
    expansion_terms: ['discussion', 'agenda', 'update', 'plan'],
  },
  {
    concept_id: 'finance_credit',
    query_text: 'finance credit payment cost and revenue review',
    primary_terms: ['finance', 'credit', 'payment', 'cost'],
    expansion_terms: ['revenue', 'budget', 'invoice', 'price'],
  },
  {
    concept_id: 'legal_compliance',
    query_text: 'legal compliance policy approval and regulation',
    primary_terms: ['legal', 'compliance', 'policy', 'approval'],
    expansion_terms: ['contract', 'regulatory', 'review', 'law'],
  },
  {
    concept_id: 'procurement_orders',
    query_text: 'purchase order vendor supplier and invoice processing',
    primary_terms: ['purchase', 'order', 'vendor', 'supplier'],
    expansion_terms: ['invoice', 'payment', 'delivery', 'request'],
  },
  {
    concept_id: 'project_updates',
    query_text: 'project update milestone planning and deliverables',
    primary_terms: ['project', 'update', 'plan', 'milestone'],
    expansion_terms: ['deliverables', 'schedule', 'status', 'meeting'],
  },
  {
    concept_id: 'security_access',
    query_text: 'security password access server and network control',
    primary_terms: ['security', 'password', 'access', 'server'],
    expansion_terms: ['network', 'login', 'control', 'system'],
  },
  {
    concept_id: 'travel_logistics',
    query_text: 'travel trip flight hotel and itinerary coordination',
    primary_terms: ['travel', 'trip', 'flight', 'hotel'],
    expansion_terms: ['itinerary', 'schedule', 'meeting', 'reservation'],
  },
];

function uniqueTerms(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const term = String(value || '').trim().toLowerCase();
    if (!term || seen.has(term)) {
      continue;
    }
    seen.add(term);
    result.push(term);
  }
  return result;
}

function resolveSemanticConcepts(availableTerms) {
  const available = availableTerms instanceof Set ? availableTerms : new Set(availableTerms || []);
  const resolved = [];

  for (const concept of SEMANTIC_CONCEPTS) {
    const primaryTerms = uniqueTerms((concept.primary_terms || []).filter((term) => available.has(term)));
    const expansionTerms = uniqueTerms((concept.expansion_terms || []).filter((term) => available.has(term) && !primaryTerms.includes(term)));
    const matchedKeywords = uniqueTerms([...primaryTerms, ...expansionTerms]);

    if (primaryTerms.length < 2 || matchedKeywords.length < 3) {
      continue;
    }

    resolved.push({
      concept_id: concept.concept_id,
      query_text: concept.query_text,
      primary_terms: primaryTerms,
      expansion_terms: expansionTerms,
      matched_keywords: matchedKeywords,
      semantic_top_k: DEFAULT_SEMANTIC_TOP_K,
    });
  }

  return resolved;
}

function buildSemanticTermWeights(query) {
  const weights = {};
  const primaryTerms = uniqueTerms(query.semantic_keywords || []);
  const matchedKeywords = uniqueTerms(query.matched_keywords || query.keywords || []);

  for (const term of primaryTerms) {
    weights[term] = PRIMARY_TERM_WEIGHT;
  }

  for (const term of matchedKeywords) {
    if (weights[term] === undefined) {
      weights[term] = EXPANSION_TERM_WEIGHT;
    }
  }

  return weights;
}

function rankSemanticCandidates(keywordEntries, termWeights, topK = DEFAULT_SEMANTIC_TOP_K) {
  const candidateMap = new Map();

  for (const keywordEntry of keywordEntries) {
    const keyword = String(keywordEntry.keyword || '').toLowerCase();
    const postingCount = Number(keywordEntry.posting_count || keywordEntry.stored_posting_count || keywordEntry.doc_freq || keywordEntry.postings.length || 1);
    const rarityWeight = 1 / Math.max(1, Math.log2(postingCount + 1));
    const weight = (termWeights[keyword] || EXPANSION_TERM_WEIGHT) * rarityWeight;

    for (const docId of keywordEntry.postings) {
      const current = candidateMap.get(docId) || {
        score: 0,
        matched_keywords: [],
        raw_keyword_hits: 0,
      };
      current.score += weight;
      current.raw_keyword_hits += 1;
      current.matched_keywords.push(keyword);
      candidateMap.set(docId, current);
    }
  }

  const ranked = [...candidateMap.entries()]
    .map(([docId, value]) => ({
      doc_id: docId,
      score: value.score,
      raw_keyword_hits: value.raw_keyword_hits,
      matched_keywords: uniqueTerms(value.matched_keywords),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.raw_keyword_hits !== left.raw_keyword_hits) {
        return right.raw_keyword_hits - left.raw_keyword_hits;
      }
      return left.doc_id.localeCompare(right.doc_id);
    });

  return {
    candidate_count: candidateMap.size,
    ranked_docs: ranked.slice(0, Math.max(0, topK)),
    all_ranked_docs: ranked,
  };
}

module.exports = {
  DEFAULT_SEMANTIC_TOP_K,
  SEMANTIC_CONCEPTS,
  resolveSemanticConcepts,
  buildSemanticTermWeights,
  rankSemanticCandidates,
};
