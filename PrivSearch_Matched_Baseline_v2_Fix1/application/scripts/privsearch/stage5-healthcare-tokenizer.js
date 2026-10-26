const ENGLISH_STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'could',
  'did', 'do', 'does', 'doing', 'down', 'during',
  'each',
  'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just',
  'me', 'more', 'most', 'my', 'myself',
  'no', 'nor', 'not', 'now',
  'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this',
  'those', 'through', 'to', 'too',
  'under', 'until', 'up',
  'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'patient', 'hospital', 'medical', 'clinical', 'doctor', 'nurse', 'record', 'records',
  'please', 'thanks', 'thank', 'follow', 'followup',
]);

function tokenizeEnglish(text, seen, tokens) {
  const englishTokens = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (const token of englishTokens) {
    if (token.length < 3 || token.length > 40) {
      continue;
    }
    if (ENGLISH_STOPWORDS.has(token)) {
      continue;
    }
    if (!/^[a-z][a-z0-9]*$/.test(token)) {
      continue;
    }
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    tokens.push(token);
  }
}

function tokenizeHan(text, seen, tokens) {
  const hanSequences = String(text || '').match(/[\p{Script=Han}]{2,}/gu) || [];

  for (const seq of hanSequences) {
    const normalized = seq.trim();
    if (!normalized) {
      continue;
    }

    if (normalized.length >= 2 && normalized.length <= 16 && !seen.has(normalized)) {
      seen.add(normalized);
      tokens.push(normalized);
    }

    for (let window = 2; window <= 3; window += 1) {
      if (normalized.length < window) {
        continue;
      }
      for (let i = 0; i <= normalized.length - window; i += 1) {
        const gram = normalized.slice(i, i + window);
        if (!seen.has(gram)) {
          seen.add(gram);
          tokens.push(gram);
        }
      }
    }
  }
}

function tokenizeMixedHealthcareText(text) {
  const seen = new Set();
  const tokens = [];

  tokenizeEnglish(text, seen, tokens);
  tokenizeHan(text, seen, tokens);

  return tokens;
}

module.exports = {
  tokenizeMixedHealthcareText,
};
