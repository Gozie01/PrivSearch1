'use strict';
const STOPWORDS = new Set([
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
  'subject', 'from', 'sent', 'message', 'original', 'forwarded', 'please', 'thanks', 'thank',
  'enron', 'com', 'http', 'https', 'www',
  'will', 'know', 'may', 'let', 'get', 'new', 'need', 'call', 'also', 'one', 'information',
  'attached', 'like', 'see', 'questions', 'mail', 'make', 'today', 'email', 'day', 'contact',
  'week', 'last', 'date', 'use', 'work', 'want', 'help', 'meeting', 'review', 'following',
  'back', 'take', 'group', 'well',
]);

function tokenize(text) {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const keywords = [];
  const seen = new Set();

  for (const token of tokens) {
    if (token.length < 3 || token.length > 32) {
      continue;
    }
    if (STOPWORDS.has(token)) {
      continue;
    }
    if (!/^[a-z][a-z0-9]*$/.test(token)) {
      continue;
    }
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    keywords.push(token);
  }

  return keywords;
}
module.exports={tokenize};
