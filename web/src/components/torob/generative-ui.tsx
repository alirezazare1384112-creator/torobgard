"use client";

/**
 * Generative UI components for the TorobGard shopping assistant.
 *
 * These are typed React components the agent can request to render structured
 * questions and product/shop information inline in the chat flow:
 *   - QuestionCard: single- or multi-select question with options.
 *   - BudgetSelector: preset budget ranges + custom min/max input.
 *   - PreferenceChips: multi-select preference chips.
 *   - GenerativeMessage: dispatcher that picks the right component from a
 *     structured payload emitted by the agent.
 *
 * Design notes:
 *   - All text in Persian, RTL layout. Uses the existing theme tokens
 *     (bg-card, border-border, text-primary, bg-primary) — no hard-coded colors.
 *   - Uses shadcn/ui Card, Button, Badge, Input from @/components/ui/*.
 *   - Subtle framer-motion entrance animation on every component.
 *   - All interactive elements have a minimum 44px touch target (min-h-11).
 *   - Accessible: ARIA roles (radiogroup/radio, group/checkbox), aria-checked,
 *     aria-label, and keyboard-navigable native <button> elements.
 *   - Selected state highlights with `border-primary bg-primary/5` + a check icon.
 *   - A "رد شدن" (skip) button is rendered when `onSkip` is provided.
 *   - Single-select QuestionCard fires onAnswer immediately on click; multi-select
 *     requires a "تأیید" button. BudgetSelector fires onAnswer immediately on preset
 *     click; custom range requires a "تأیید" button. PreferenceChips always requires
 *     a "تأیید" button (multi-select only).
 */

import * as React from "react";
import { motion } from "framer-motion";
import { Check, HelpCircle, Sparkles, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatNumber, toPersianDigits } from "./format";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface QuestionOption {
  /** The option value sent back to the agent. */
  value: string;
  /** Display label in Persian. */
  label: string;
  /** Optional emoji or short text shown before the label. */
  icon?: string;
}

export interface QuestionCardProps {
  /** The question in Persian. */
  title: string;
  /** Optional "why this matters" muted explanation. */
  why?: string;
  options: QuestionOption[];
  /** Allow multiple selections (default: false → single-select). */
  multiSelect?: boolean;
  onAnswer: (selected: string[]) => void;
  onSkip?: () => void;
}

export interface BudgetPreset {
  label: string;
  min: number;
  max: number;
}

export interface BudgetSelectorProps {
  title: string;
  presets: BudgetPreset[];
  onAnswer: (budget: { min: number; max: number }) => void;
  onSkip?: () => void;
}

export interface PreferenceChip {
  value: string;
  label: string;
}

export interface PreferenceChipsProps {
  title: string;
  why?: string;
  chips: PreferenceChip[];
  onAnswer: (selected: string[]) => void;
  onSkip?: () => void;
}

export type GenerativePayload =
  | { type: "question"; title: string; why?: string; options: QuestionOption[]; multiSelect?: boolean }
  | { type: "budget"; title: string; presets: BudgetPreset[] }
  | { type: "preference"; title: string; why?: string; chips: PreferenceChip[] };

export type GenerativeAnswer = string | string[] | { min: number; max: number };

/* ------------------------------------------------------------------ */
/* Shared entrance animation                                          */
/* ------------------------------------------------------------------ */

const entranceVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
} as const;

const entranceTransition = { duration: 0.2, ease: "easeOut" as const };

/* ------------------------------------------------------------------ */
/* QuestionCard                                                        */
/* ------------------------------------------------------------------ */

export function QuestionCard({
  title,
  why,
  options,
  multiSelect = false,
  onAnswer,
  onSkip,
}: QuestionCardProps) {
  const [selected, setSelected] = React.useState<string[]>([]);
  const [showCustom, setShowCustom] = React.useState(false);
  const [customText, setCustomText] = React.useState("");

  const toggle = React.useCallback(
    (value: string) => {
      setShowCustom(false);
      setCustomText("");
      if (multiSelect) {
        setSelected((prev) =>
          prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
        );
      } else {
        // Single-select: selecting one deselects others, fire immediately.
        setSelected([value]);
        onAnswer([value]);
      }
    },
    [multiSelect, onAnswer]
  );

  const submitMulti = () => {
    const all = [...selected];
    if (showCustom && customText.trim()) all.push(customText.trim());
    if (all.length > 0) onAnswer(all);
  };

  const submitCustomSingle = () => {
    if (customText.trim()) onAnswer([customText.trim()]);
  };

  return (
    <motion.div
      initial={entranceVariants.initial}
      animate={entranceVariants.animate}
      transition={entranceTransition}
    >
      <Card className="gap-3 p-4">
        <header className="flex flex-col gap-1">
          <h3 className="flex items-start gap-2 text-sm font-semibold leading-relaxed">
            <HelpCircle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>{title}</span>
          </h3>
          {why && (
            <p className="pr-6 text-xs leading-relaxed text-muted-foreground">{why}</p>
          )}
        </header>

        <div
          role={multiSelect ? "group" : "radiogroup"}
          aria-label={title}
          className="flex flex-col gap-2"
        >
          {options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                role={multiSelect ? "checkbox" : "radio"}
                aria-checked={isSelected}
                onClick={() => toggle(opt.value)}
                className={[
                  "flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-right text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  isSelected
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border bg-card text-foreground hover:bg-accent",
                ].join(" ")}
              >
                {opt.icon && (
                  <span className="text-base leading-none" aria-hidden>
                    {opt.icon}
                  </span>
                )}
                <span className="flex-1">{opt.label}</span>
                {isSelected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
              </button>
            );
          })}

          {/* "Other / I'll type my own answer" option */}
          {!showCustom ? (
            <button
              type="button"
              onClick={() => { setShowCustom(true); setSelected([]); }}
              className="flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-right text-sm text-muted-foreground transition-colors hover:bg-accent"
            >
              <span className="flex-1">دیگری / خودم می‌نویسم</span>
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-2">
              <Input
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="پاسخ خودت را بنویس…"
                className="min-h-11 text-sm"
                aria-label="پاسخ دلخواه"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (multiSelect) submitMulti();
                    else submitCustomSingle();
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                className="h-9 gap-1.5 self-start"
                onClick={() => multiSelect ? submitMulti() : submitCustomSingle()}
                disabled={!customText.trim()}
              >
                <Check className="size-3.5" aria-hidden />
                تأیید
              </Button>
            </div>
          )}
        </div>

        <div
          className={[
            "flex items-center gap-2 pt-1",
            onSkip ? "justify-between" : "justify-end",
          ].join(" ")}
        >
          {onSkip && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="min-h-11 px-4 text-xs text-muted-foreground"
              onClick={onSkip}
            >
              رد شدن
            </Button>
          )}
          {multiSelect && (
            <Button
              type="button"
              size="lg"
              className="min-h-11 gap-1.5 px-4"
              onClick={submitMulti}
              disabled={selected.length === 0 && !(showCustom && customText.trim())}
            >
              <Check className="size-4" aria-hidden />
              تأیید
              {(selected.length + (showCustom && customText.trim() ? 1 : 0)) > 0
                ? ` (${toPersianDigits(selected.length + (showCustom && customText.trim() ? 1 : 0))})`
                : ""}
            </Button>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* BudgetSelector                                                      */
/* ------------------------------------------------------------------ */

export function BudgetSelector({
  title,
  presets,
  onAnswer,
  onSkip,
}: BudgetSelectorProps) {
  const [activePreset, setActivePreset] = React.useState<number | null>(null);
  const [customMin, setCustomMin] = React.useState("");
  const [customMax, setCustomMax] = React.useState("");

  const selectPreset = (idx: number, preset: BudgetPreset) => {
    setActivePreset(idx);
    setCustomMin("");
    setCustomMax("");
    onAnswer({ min: preset.min, max: preset.max });
  };

  const submitCustom = () => {
    const maxVal = customMax.trim() ? Number(customMax) : NaN;
    if (!Number.isFinite(maxVal) || maxVal <= 0) return;
    const minVal = customMin.trim() ? Number(customMin) : 0;
    if (!Number.isFinite(minVal) || minVal < 0) return;
    if (minVal > maxVal) return;
    setActivePreset(null);
    onAnswer({ min: minVal, max: maxVal });
  };

  return (
    <motion.div
      initial={entranceVariants.initial}
      animate={entranceVariants.animate}
      transition={entranceTransition}
    >
      <Card className="gap-3 p-4">
        <header className="flex items-start gap-2">
          <Wallet className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <h3 className="text-sm font-semibold leading-relaxed">{title}</h3>
        </header>

        {presets.length > 0 && (
          <div
            role="radiogroup"
            aria-label={title}
            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            {presets.map((preset, idx) => {
              const isActive = activePreset === idx;
              return (
                <button
                  key={`${preset.label}-${idx}`}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => selectPreset(idx, preset)}
                  className={[
                    "flex min-h-11 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-right transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    isActive
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:bg-accent",
                  ].join(" ")}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm font-medium">{preset.label}</span>
                    {isActive && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                  </span>
                  <span className="font-num text-xs text-muted-foreground" dir="rtl">
                    {formatNumber(preset.min)} تا {formatNumber(preset.max)} تومان
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            یا بازهٔ دلخواه وارد کن:
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={customMin}
              onChange={(e) => setCustomMin(e.target.value)}
              placeholder="حداقل (تومان)"
              className="min-h-11"
              aria-label="حداقل بودجه به تومان"
            />
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={customMax}
              onChange={(e) => setCustomMax(e.target.value)}
              placeholder="حداکثر (تومان)"
              className="min-h-11"
              aria-label="حداکثر بودجه به تومان"
            />
          </div>
        </div>

        <div
          className={[
            "flex items-center gap-2 pt-1",
            onSkip ? "justify-between" : "justify-end",
          ].join(" ")}
        >
          {onSkip && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="min-h-11 px-4 text-xs text-muted-foreground"
              onClick={onSkip}
            >
              رد شدن
            </Button>
          )}
          <Button
            type="button"
            size="lg"
            className="min-h-11 gap-1.5 px-4"
            onClick={submitCustom}
            disabled={!customMax.trim() || !Number.isFinite(Number(customMax)) || Number(customMax) <= 0}
          >
            <Check className="size-4" aria-hidden />
            تأیید بازهٔ دلخواه
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* PreferenceChips                                                     */
/* ------------------------------------------------------------------ */

export function PreferenceChips({
  title,
  why,
  chips,
  onAnswer,
  onSkip,
}: PreferenceChipsProps) {
  const [selected, setSelected] = React.useState<string[]>([]);

  const toggle = (value: string) => {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const submit = () => {
    if (selected.length > 0) onAnswer(selected);
  };

  return (
    <motion.div
      initial={entranceVariants.initial}
      animate={entranceVariants.animate}
      transition={entranceTransition}
    >
      <Card className="gap-3 p-4">
        <header className="flex flex-col gap-1">
          <h3 className="flex items-start gap-2 text-sm font-semibold leading-relaxed">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>{title}</span>
          </h3>
          {why && (
            <p className="pr-6 text-xs leading-relaxed text-muted-foreground">{why}</p>
          )}
        </header>

        <div role="group" aria-label={title} className="flex flex-wrap gap-2">
          {chips.map((chip) => {
            const isSelected = selected.includes(chip.value);
            return (
              <button
                key={chip.value}
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                onClick={() => toggle(chip.value)}
                className={[
                  "flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  isSelected
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border bg-card text-foreground hover:bg-accent",
                ].join(" ")}
              >
                {isSelected && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
                {chip.label}
              </button>
            );
          })}
        </div>

        <div
          className={[
            "flex items-center gap-2 pt-1",
            onSkip ? "justify-between" : "justify-end",
          ].join(" ")}
        >
          {onSkip && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="min-h-11 px-4 text-xs text-muted-foreground"
              onClick={onSkip}
            >
              رد شدن
            </Button>
          )}
          <Button
            type="button"
            size="lg"
            className="min-h-11 gap-1.5 px-4"
            onClick={submit}
            disabled={selected.length === 0}
          >
            <Check className="size-4" aria-hidden />
            تأیید
            {selected.length > 0 ? ` (${toPersianDigits(selected.length)})` : ""}
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* GenerativeMessage (dispatcher)                                     */
/* ------------------------------------------------------------------ */

export function GenerativeMessage({
  payload,
  onAnswer,
  onSkip,
}: {
  payload: GenerativePayload;
  onAnswer: (answer: GenerativeAnswer) => void;
  onSkip?: () => void;
}) {
  switch (payload.type) {
    case "question":
      return (
        <QuestionCard
          title={payload.title}
          why={payload.why}
          options={payload.options}
          multiSelect={payload.multiSelect}
          onAnswer={onAnswer}
          onSkip={onSkip}
        />
      );
    case "budget":
      return (
        <BudgetSelector
          title={payload.title}
          presets={payload.presets}
          onAnswer={onAnswer}
          onSkip={onSkip}
        />
      );
    case "preference":
      return (
        <PreferenceChips
          title={payload.title}
          why={payload.why}
          chips={payload.chips}
          onAnswer={onAnswer}
          onSkip={onSkip}
        />
      );
  }
}
