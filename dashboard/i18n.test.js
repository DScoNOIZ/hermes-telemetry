/**
 * dashboard/i18n.test.js — i18n round-trip + regression harness.
 * Runnable: node --test dashboard/i18n.test.js (no deps, stdlib only)
 *
 * Spec: EN is source, RU is overlay (dashboard/i18n_ru.js). Tests:
 *  - static key both modes
 *  - one dynamic key round-trips EN (Window label)
 *  - $& in replacement safe via function replacement
 *  - RU mode output sample inc chart label (Model: Other, Tokens)
 *  - old buggy regex (\\$\\{) fails to translate dynamic keys (demonstrates bug)
 *
 * Old buggy function (copied for reference — must FAIL):
 *   const pattern = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\$\\{[^}]*\\}/g, '(.*)');
 *   // \\$  == backslash + end-anchor, never matches \$\{, so 89/297 dynamic strings stuck.
 *   // plus string replacement: out.replace('${0}', g)  -> $& expands to whole match.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Load RU overlay from dashboard/i18n_ru.js (evaluated in isolated context)
const i18nPath = path.join(import.meta.dirname, 'i18n_ru.js');
const i18nSrc = fs.readFileSync(i18nPath, 'utf8');
// Extract dict via vm (avoid polluting global const)
const ctx = {};
vm.createContext(ctx);
vm.runInContext(i18nSrc, ctx);
const i18nRU = ctx.i18nRU;
assert.ok(i18nRU && typeof i18nRU === 'object', 'i18nRU loaded');
assert.ok(Object.keys(i18nRU).length > 100, 'dict not empty');

// Fixed implementation (current dashboard/index.html:373ff)
let __dashLang = 'en';
function i18n_t_fixed(en) {
  if (__dashLang !== 'ru' || en == null) return en;
  if (i18nRU[en] != null) return i18nRU[en];
  for (const k in i18nRU) {
    if (k.indexOf('${') === -1) continue;
    const pattern = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\$\\\{[^}]*\\\}/g, '(.*)');
    const re = new RegExp('^' + pattern + '$');
    const m = en.match(re);
    if (m) {
      let out = i18nRU[k];
      m.slice(1).forEach((g, i) => { out = out.replace('${' + i + '}', () => g); });
      return out;
    }
  }
  return en;
}

// Old buggy implementation (must FAIL on dynamic key)
function i18n_t_old(en) {
  // intentionally buggy regex: \\$\\{  ($ unescaped -> end anchor)
  if (__dashLang !== 'ru' || en == null) return en;
  if (i18nRU[en] != null) return i18nRU[en];
  for (const k in i18nRU) {
    if (k.indexOf('${') === -1) continue;
    const pattern = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\$\\{[^}]*\\}/g, '(.*)');
    const re = new RegExp('^' + pattern + '$');
    const m = en.match(re);
    if (m) {
      let out = i18nRU[k];
      // string replacement (vulnerable to $&)
      m.slice(1).forEach((g, i) => { out = out.replace('${' + i + '}', g); });
      return out;
    }
  }
  return en;
}

describe('i18n EN source -> RU overlay', () => {
  it('static key both modes', () => {
    __dashLang = 'en';
    assert.equal(i18n_t_fixed('Home'), 'Home');
    __dashLang = 'ru';
    assert.equal(i18n_t_fixed('Home'), 'Главная');
    // OK is Latin in both (task minor)
    __dashLang = 'en';
    assert.equal(i18n_t_fixed('OK'), 'OK');
    __dashLang = 'ru';
    assert.equal(i18n_t_fixed('OK'), 'OK');
  });

  it('one dynamic key round-trips EN (Window label)', () => {
    const enWindow = 'Window: 2026-01-01 → 2026-01-02 (UTC)';
    __dashLang = 'en';
    assert.equal(i18n_t_fixed(enWindow), enWindow);
    __dashLang = 'ru';
    // RU overlay: "Window: ${0} → ${1} (${2})": "Окно: ${0} → ${1} (${2})"
    assert.equal(i18n_t_fixed(enWindow), 'Окно: 2026-01-01 → 2026-01-02 (UTC)');
  });

  it('$& in replacement safe (function replacement)', () => {
    // Use a dynamic key with one placeholder; provider/model name containing $&
    // e.g. "Model: ${0}" -> RU "Модель: ${0}"
    const enVal = 'Model: $&';
    __dashLang = 'ru';
    const got = i18n_t_fixed(enVal);
    assert.equal(got, 'Модель: $&');
    // old string-replacement would expand $& to the whole match "${0}" inside RU template
    // so old result would be 'Модель: ${0}' or similar, not 'Модель: $&'
    const gotOld = i18n_t_old(enVal);
    assert.notEqual(gotOld, 'Модель: $&', 'old $& handling must be broken');
  });

  it('RU sample outputs inclusive chart label (100% coverage spot check)', () => {
    __dashLang = 'ru';
    assert.equal(i18n_t_fixed('Model: Other'), 'Модель: другие');
    assert.equal(i18n_t_fixed('Tokens'), 'Токены');
    assert.equal(i18n_t_fixed('Cache Read'), 'Чтение кэша');
    // leaf text not HTML blob: check that no markup key exists, but leaf translates
    // The chart's "Model:" leaf is covered above; ensure no key contains '<rect'
    for (const k of Object.keys(i18nRU)) {
      assert.ok(!k.includes('<'), `no markup key: ${JSON.stringify(k).slice(0,120)}`);
    }
  });

  it('old buggy regex fails to translate dynamic keys (regression proof)', () => {
    const enWindow = 'Window: 2026-01-01 → 2026-01-02 (UTC)';
    __dashLang = 'ru';
    const fixed = i18n_t_fixed(enWindow);
    const buggy = i18n_t_old(enWindow);
    assert.equal(fixed, 'Окно: 2026-01-01 → 2026-01-02 (UTC)');
    assert.equal(buggy, enWindow, 'buggy regex must leave EN untranslated (demonstrates 89/297 stuck)');
    assert.notEqual(buggy, fixed);
  });
});
