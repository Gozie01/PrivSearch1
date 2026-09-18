const { PostingsBaselineEngine }   = require('./engines/postings-baseline-engine');
const { PrivSearchPrototypeEngine } = require('./engines/privsearch-prototype-engine');
const { SeaCQBaselineEngine }       = require('./engines/seacq-baseline-engine');

function createEngine(name, options = {}) {
  if (name === 'postings-baseline') {
    return new PostingsBaselineEngine(options);
  }

  if (name === 'privsearch-prototype') {
    return new PrivSearchPrototypeEngine(options);
  }

  // Same-stack SeaCQ conjunctive-path reimplementation.
  // Uses identical OXT intersection; differs only in two-stage full-result
  // accumulator verification rather than PrivSearch's sampled approach.
  if (name === 'seacq-baseline') {
    return new SeaCQBaselineEngine(options);
  }

  throw new Error(
    `Unsupported engine "${name}". Available engines: postings-baseline, privsearch-prototype, seacq-baseline.`,
  );
}

module.exports = { createEngine };
