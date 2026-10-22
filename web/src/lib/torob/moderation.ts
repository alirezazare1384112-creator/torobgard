/**
 * Persian/English profanity moderation for the TorobGard assistant.
 *
 * Shared by the server (agent route) and the client (chat UI) so that no
 * model-generated text — final replies, per-step "thinking", or questions —
 * ever reaches the page uncensored. Defense in depth:
 *
 *   1. The system prompt tells the model to stay polite (primary).
 *   2. This sanitizer catches the common vulgar stems with tolerant matching
 *      (ZWNJ/space/dot separators, repeated letters, Arabic↔Persian chars,
 *      common suffixes like «کصشرت», «کیرم», «جندهه» …).
 *   3. The client re-sanitizes anything it renders.
 *
 * Design notes:
 * - Text is normalized (Arabic→Persian letters, diacritics/tatweel/ZWNJ
 *   stripped, latin lowercased) before matching; if nothing matched the
 *   ORIGINAL text is returned untouched (so clean replies keep their nice
 *   ZWNJ typography like «می‌خواهم»).
 * - No lookbehind (Safari-safe): left boundaries use `(^|[^…])` capture
 *   groups and replacements preserve the boundary via `$1`.
 * - Deliberately avoids ambiguous stems that collide with shopping language:
 *   «ساک» (handbag), «خر» inside «خرید», «سگ» standalone (pet supplies),
 *   «کس» alone (person), «نفهمیدن», «تکون» …
 */

const FA = "\\u0600-\\u06FF";
/** Left boundary: start-of-string or a non-letter (kept in the replacement). */
const L = `(^|[^a-z${FA}])`;
/** Separators tolerated *inside* a vulgar word (obfuscation). */
const SEP = `[\\s._\\-]*`;

function normalizeForModeration(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // diacritics + tatweel
    .replace(/\u200c/g, " ") // ZWNJ → space (so «کص‌شرت» still matches)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Vulgar stem patterns (matched against normalized text). */
const RAW_PATTERNS: string[] = [
  // کص family — this spelling is inherently vulgar; absorbs direct suffixes
  // (کصشرت/کصکش/کصده…) and spaced ones (کص شرت، کص ننت…).
  `${L}ک+${SEP}ص+(?:${SEP}(?:شرت?|عصرت?|ننت|ننات|مامان(?:ت)?|مادر(?:ت|ش)?|خواهر(?:ت)?|کش|ده|مال|تو|چش))?(?:[${FA}]{0,4})?`,
  // کس family — only in compounds (plain «کس» means "person"; «کسی» stays safe).
  `${L}ک+س+${SEP}(?:شرت?|عصرت?|ننت|ننات|مامان(?:ت)?|مادر(?:ت|ش)?|خواهر(?:ت)?|کش|ده|مال)`,
  // کیر (blocked inside innocent words like «تفکیر» by the left boundary).
  `${L}ک+${SEP}ی+${SEP}ر+(?:${SEP}(?:تو|ده|سفت))?(?:[${FA}]{0,5})?`,
  // کون / کونی (left boundary keeps «تکون» safe).
  `${L}ک+${SEP}?و+ن+(?:${SEP}(?:گردن|مال|دهن))?(?:[${FA}]{0,3})?`,
  // جنده
  `${L}ج+ن+د+ه+(?:[${FA}]{0,3})?`,
  // حرامزاده / حرومزاده
  `${L}حر[اا]*[و]?م+${SEP}ز+[اا]*د+ه+(?:[${FA}]{0,3})?`,
  // عوضی (standalone insult only)
  `${L}عوضی(?![${FA}])`,
  // خارکس(ر)
  `${L}خار[کك]س(?:[${FA}]{0,3})?`,
  // پدرسگ / مادرسگ / ننه‌سگ / سگلاقور
  `${L}(?:پدر${SEP}س[گک]+|مادر${SEP}س[گک]+|نن[هه]${SEP}س[گک]+|س[گک]+${SEP}لاق[وو]?ر)(?:[${FA}]{0,3})?`,
  // ممه
  `${L}م+م+ه+(?![${FA}])`,
  // ممل
  `${L}م+م+ل+(?![${FA}])`,
  // قحبه
  `${L}ق+ح+ب+ه+(?:[${FA}]{0,3})?`,
  // کثافت (insult usage)
  `${L}کثافت(?:[${FA}]{0,4})?`,
  // mild insults the assistant must never use (احمق/احمقی/احمق‌ها …)
  `${L}(?:احمق|ابله|بی${SEP}شعور|کله${SEP}پوک|خنگ)(?:ی|ها)?(?![${FA}])`,
  `${L}نفهم(?![${FA}])`,
  // English
  `(^|[^a-z])f+${SEP}u+${SEP}c+${SEP}k+(?:[a-z]{0,6})?`,
  `(^|[^a-z])m+${SEP}o+${SEP}t+${SEP}h+${SEP}e+${SEP}r+${SEP}f+${SEP}u+${SEP}c+${SEP}k+(?:[a-z]{0,6})?`,
  `(^|[^a-z])s+${SEP}h+${SEP}i+${SEP}t+(?:[a-z]{0,6})?`,
  `(^|[^a-z])b+${SEP}i+${SEP}t+${SEP}c+${SEP}h+(?:[a-z]{0,6})?`,
  `(^|[^a-z])a+${SEP}s+${SEP}s+${SEP}h+${SEP}o+${SEP}l+${SEP}e+(?:[a-z]{0,6})?`,
  `(^|[^a-z])c+${SEP}u+${SEP}n+${SEP}t+(?:[a-z]{0,6})?`,
  `(^|[^a-z])d+${SEP}i+${SEP}c+${SEP}k+(?![a-z])`,
  `(^|[^a-z])b+${SEP}a+${SEP}s+${SEP}t+${SEP}a+${SEP}r+${SEP}d+(?:[a-z]{0,3})?`,
];

const COMPILED: RegExp[] = RAW_PATTERNS.map((src) => {
  try {
    return new RegExp(src, "g");
  } catch {
    return new RegExp("(__never__)", "g");
  }
});

/** True when the text contains profanity (detection only). */
export function hasProfanity(text: string): boolean {
  if (!text) return false;
  const norm = normalizeForModeration(text);
  return COMPILED.some((re) => {
    re.lastIndex = 0;
    return re.test(norm);
  });
}

/**
 * Censors vulgar words. Clean text is returned byte-for-byte unchanged;
 * dirty text comes back normalized with matches replaced by `replacement`.
 */
export function sanitizeText(text: string, replacement = "«•••»"): string {
  if (!text) return text;
  const norm = normalizeForModeration(text);
  let out = norm;
  let changed = false;
  for (const re of COMPILED) {
    re.lastIndex = 0;
    const next = out.replace(re, `$1${replacement}`);
    if (next !== out) changed = true;
    out = next;
  }
  return changed ? out : text;
}

/** Sanitized copy for model input: keeps intent visible without the slur. */
export function sanitizeForModel(text: string): string {
  return sanitizeText(text, "[توهین حذف شد]");
}
