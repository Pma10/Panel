/**
 * UI translation. Korean is the source text: the app renders Korean and,
 * for other languages, a MutationObserver swaps each text node / label for
 * its translation (exact phrase first, then patterns for text with numbers).
 * Server error messages pass through the same dictionary.
 * To add a language: add it to LANGUAGES and give it a dictionary in i18n-<code>.js.
 */
import { EN, EN_PATTERNS } from "./i18n-en.js";

export const LANGUAGES = { ko: "한국어", en: "English" };
const DICTIONARIES = { en: { words: EN, patterns: EN_PATTERNS } };
const HANGUL = /[가-힣]/;
// User content and code are never translated.
const SKIP = "#log-rows, .monaco-host, textarea, .file-name, .server-name, .selector-title, .java-path, .command-preview, [data-no-i18n]";
const ATTRIBUTES = ["placeholder", "title", "aria-label"];

let active = null;

export function detectLanguage() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("pconn-lang")); } catch {}
  if (LANGUAGES[saved]) return saved;
  const browser = String(navigator.language || "ko").slice(0, 2);
  return LANGUAGES[browser] ? browser : "en";
}

export function translate(text) {
  if (!active || !text || !HANGUL.test(text)) return text;
  const trimmed = text.trim();
  const exact = active.words[trimmed];
  if (exact !== undefined) return text.replace(trimmed, exact);
  for (const [pattern, replacement] of active.patterns) {
    if (pattern.test(trimmed)) return text.replace(trimmed, trimmed.replace(pattern, replacement));
  }
  return text;
}

function translateNode(node) {
  if (node.nodeType === 3) {
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) return;
    const next = translate(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
    return;
  }
  if (node.nodeType !== 1 || node.closest(SKIP)) return;
  for (const name of ATTRIBUTES) {
    const value = node.getAttribute(name);
    if (value && HANGUL.test(value)) node.setAttribute(name, translate(value));
  }
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === 1 && n.matches(SKIP)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) {
      const next = translate(n.nodeValue);
      if (next !== n.nodeValue) n.nodeValue = next;
    } else for (const name of ATTRIBUTES) {
      const value = n.getAttribute(name);
      if (value && HANGUL.test(value)) n.setAttribute(name, translate(value));
    }
  }
}

export function startI18n(lang) {
  document.documentElement.lang = lang;
  active = DICTIONARIES[lang] || null;
  if (!active) return;
  translateNode(document.body);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") translateNode(record.target);
      else for (const node of record.addedNodes) translateNode(node);
    }
    const title = translate(document.title);
    if (title !== document.title) document.title = title;
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

export function setLanguage(lang) {
  try { localStorage.setItem("pconn-lang", JSON.stringify(lang)); } catch {}
  location.reload();
}

// Debug helper for maintainers: list Korean text left untranslated on screen.
export function missingTranslations() {
  const found = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.nodeType === 1 ? n : n.parentElement;
    if (!el || el.closest(SKIP)) continue;
    if (n.nodeType === 3 && HANGUL.test(n.nodeValue)) found.add(n.nodeValue.trim());
    if (n.nodeType === 1) for (const name of ATTRIBUTES) { const v = n.getAttribute(name); if (v && HANGUL.test(v)) found.add(v); }
  }
  return [...found];
}
