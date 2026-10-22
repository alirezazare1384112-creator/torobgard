/**
 * Structured shopping session state — persists across turns.
 *
 * Tracks the user's intent, preferences, budget, and shopping context so the
 * agent can ask adaptive questions, avoid re-asking, and re-rank when the user
 * changes their mind.
 */

export interface ShoppingSession {
  // intent
  category: string | null;
  productQuery: string | null;
  intendedUse: string | null; // university, walking, running, everyday, mixed...

  // budget
  budgetMin: number | null; // toman
  budgetMax: number | null;

  // preferences (configurable weights)
  priority: "comfort" | "appearance" | "durability" | "price" | "balanced" | null;
  style: string | null; // minimal, sporty, casual, formal-casual
  brandPreference: string | null; // specific brand, or null = no preference
  installmentOnly: boolean;

  // location
  neighborhood: string | null;
  lat: number | null;
  lon: number | null;

  // shopping list
  selectedProductIds: string[];
  excludedProductIds: string[];

  // metadata
  answersGiven: string[]; // keys of questions already answered
  createdAt: string;
  updatedAt: string;
}

export function createSession(): ShoppingSession {
  return {
    category: null,
    productQuery: null,
    intendedUse: null,
    budgetMin: null,
    budgetMax: null,
    priority: null,
    style: null,
    brandPreference: null,
    installmentOnly: false,
    neighborhood: null,
    lat: null,
    lon: null,
    selectedProductIds: [],
    excludedProductIds: [],
    answersGiven: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Update the session with a partial patch and bump updatedAt. */
export function updateSession(
  session: ShoppingSession,
  patch: Partial<ShoppingSession>
): ShoppingSession {
  return { ...session, ...patch, updatedAt: new Date().toISOString() };
}

/** Category-aware question templates. Different products need different questions.
 *  The generic flow is: budget → use → priority → installment. But for specific
 *  categories, we can ask more targeted questions. */
const CATEGORY_QUESTIONS: Record<string, {
  useOptions?: { value: string; label: string }[];
  priorityChips?: { value: string; label: string }[];
  styleOptions?: { value: string; label: string }[];
}> = {
  // Shoes/sneakers
  "کفش": {
    useOptions: [
      { value: "university", label: "دانشگاه" },
      { value: "walking", label: "پیاده‌روی" },
      { value: "running", label: "دویدن" },
      { value: "everyday", label: "هر روز" },
      { value: "mixed", label: "ترکیبی" },
    ],
    priorityChips: [
      { value: "comfort", label: "راحتی" },
      { value: "appearance", label: "ظاهر" },
      { value: "durability", label: "دوام" },
      { value: "price", label: "قیمت" },
    ],
    styleOptions: [
      { value: "minimal", label: "مینیمال" },
      { value: "sporty", label: "اسپرت" },
      { value: "casual", label: "کژوال" },
      { value: "formal-casual", label: "رسمی-کژوال" },
    ],
  },
  "کتونی": {
    useOptions: [
      { value: "university", label: "دانشگاه" },
      { value: "walking", label: "پیاده‌روی" },
      { value: "running", label: "دویدن" },
      { value: "everyday", label: "هر روز" },
      { value: "mixed", label: "ترکیبی" },
    ],
    priorityChips: [
      { value: "comfort", label: "راحتی" },
      { value: "appearance", label: "ظاهر" },
      { value: "durability", label: "دوام" },
      { value: "price", label: "قیمت" },
    ],
  },
  // Electronics
  "ماوس": {
    useOptions: [
      { value: "office", label: "کار اداری" },
      { value: "gaming", label: "گیمینگ" },
      { value: "everyday", label: "هر روز" },
    ],
    priorityChips: [
      { value: "comfort", label: "راحتی دست" },
      { value: "precision", label: "دقت" },
      { value: "price", label: "قیمت" },
      { value: "wireless", label: "بی‌سیم" },
    ],
  },
  "کیبورد": {
    useOptions: [
      { value: "programming", label: "برنامه‌نویسی" },
      { value: "gaming", label: "گیمینگ" },
      { value: "office", label: "کار اداری" },
      { value: "everyday", label: "هر روز" },
    ],
    priorityChips: [
      { value: "comfort", label: "راحتی تایپ" },
      { value: "mechanical", label: "مکانیکی" },
      { value: "quiet", label: "بی‌صدا" },
      { value: "price", label: "قیمت" },
    ],
  },
  "لپ‌تاپ": {
    useOptions: [
      { value: "university", label: "دانشگاه" },
      { value: "work", label: "کار" },
      { value: "gaming", label: "گیمینگ" },
      { value: "everyday", label: "هر روز" },
    ],
    priorityChips: [
      { value: "performance", label: "عملکرد" },
      { value: "portability", label: "سبکی" },
      { value: "battery", label: "باتری" },
      { value: "price", label: "قیمت" },
    ],
  },
  "هدفون": {
    useOptions: [
      { value: "calls", label: "تماس" },
      { value: "music", label: "موسیقی" },
      { value: "gaming", label: "گیمینگ" },
      { value: "everyday", label: "هر روز" },
    ],
    priorityChips: [
      { value: "sound", label: "کیفیت صدا" },
      { value: "comfort", label: "راحتی" },
      { value: "noise_cancel", label: "حذف نویز" },
      { value: "price", label: "قیمت" },
    ],
  },
};

/** Get category-specific options, or fall back to generic ones. */
function getOptionsForCategory(
  category: string | null,
  field: "useOptions" | "priorityChips"
): { value: string; label: string }[] | null {
  if (!category) return null;
  // Try exact match, then partial match
  const cat = CATEGORY_QUESTIONS[category];
  if (cat && cat[field]) return cat[field]!;
  // Try partial match (e.g. "کفش کتونی" matches "کفش")
  for (const key of Object.keys(CATEGORY_QUESTIONS)) {
    if (category.includes(key)) {
      const c = CATEGORY_QUESTIONS[key];
      if (c[field]) return c[field]!;
    }
  }
  return null;
}

/** Determine the next most important missing piece of info, or null if ready
 *  to search. Returns a question key + the GenerativePayload for the UI. */
export function nextQuestion(
  session: ShoppingSession
):
  | { key: string; payload: import("./generative-ui").GenerativePayload }
  | null {
  // Don't ask if we don't even know what the user wants to buy
  if (!session.productQuery && !session.category) {
    return null; // the LLM should ask in natural language
  }

  // Priority 1: budget (if not stated)
  if (
    session.budgetMax === null &&
    !session.answersGiven.includes("budget")
  ) {
    return {
      key: "budget",
      payload: {
        type: "budget",
        title: "حدود بودجه‌ات چقدره؟",
        presets: [
          { label: "کمتر از ۱ میلیون", min: 0, max: 1_000_000 },
          { label: "۱ تا ۵ میلیون", min: 1_000_000, max: 5_000_000 },
          { label: "۵ تا ۲۰ میلیون", min: 5_000_000, max: 20_000_000 },
          { label: "بیشتر از ۲۰ میلیون", min: 20_000_000, max: 100_000_000 },
        ],
      },
    };
  }

  // Priority 2: intended use (if not stated) — category-aware
  if (
    session.intendedUse === null &&
    !session.answersGiven.includes("use")
  ) {
    const useOptions = getOptionsForCategory(session.category, "useOptions");
    return {
      key: "use",
      payload: {
        type: "question",
        title: "برای چه کاری می‌خوای؟",
        why: "تا محصول مناسب استفادهٔ شما پیشنهاد بدم.",
        options: useOptions ?? [
          { value: "university", label: "دانشگاه" },
          { value: "work", label: "کار" },
          { value: "everyday", label: "هر روز" },
          { value: "mixed", label: "ترکیبی" },
        ],
      },
    };
  }

  // Priority 3: priority (comfort vs appearance vs price) — category-aware
  if (
    session.priority === null &&
    !session.answersGiven.includes("priority")
  ) {
    const priorityChips = getOptionsForCategory(session.category, "priorityChips");
    return {
      key: "priority",
      payload: {
        type: "preference",
        title: "چه چیزی برات مهم‌تره؟",
        why: "اولویت‌ات روی پیشنهاد‌ها تأثیر می‌ذاره.",
        chips: priorityChips ?? [
          { value: "comfort", label: "راحتی" },
          { value: "appearance", label: "ظاهر" },
          { value: "durability", label: "دوام" },
          { value: "price", label: "قیمت" },
        ],
      },
    };
  }

  // Priority 4: installment
  if (
    !session.installmentOnly &&
    !session.answersGiven.includes("installment")
  ) {
    return {
      key: "installment",
      payload: {
        type: "question",
        title: "خرید قسطی نیاز داری؟",
        options: [
          { value: "yes", label: "بله، فقط قسطی" },
          { value: "no", label: "فرقی نداره" },
        ],
      },
    };
  }

  // Ready to search
  return null;
}

/** Build search filters from the session state. */
export function sessionToFilters(
  session: ShoppingSession
): {
  query: string;
  max_price: number | null;
  min_price: number | null;
  near: string | null;
  installment_only: boolean;
  sort: string;
  lat: number | null;
  lon: number | null;
} {
  return {
    query: session.productQuery ?? session.category ?? "",
    max_price: session.budgetMax,
    min_price: session.budgetMin,
    near: session.neighborhood,
    installment_only: session.installmentOnly,
    sort: session.priority === "price" ? "price_asc" : "relevance",
    lat: session.lat,
    lon: session.lon,
  };
}
