'use strict';
/*
  CMVOCA 단어 학습 HTML에서 단어 데이터만 읽어 낸다.
  - 학습 HTML 안의 `const DATA = { ... };` 는 순수 JSON 이다.
  - HTML 안의 코드를 실행하지 않는다 (eval·Function 사용 금지). 문자열 괄호를 세어 JSON 만 잘라 JSON.parse 한다.
  - 기존 학습 자료(HTML)는 읽기만 하고 고치지 않는다.
*/

function sliceDataObject(html) {
  const m = /const\s+DATA\s*=\s*\{/.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  return null;
}

/** 단어 학습 HTML 인지 확인하고 단어 목록을 돌려준다. */
function extractWordData(html) {
  if (typeof html !== 'string' || html.length === 0) return { ok: false, reason: 'EMPTY' };
  const raw = sliceDataObject(html);
  if (!raw) return { ok: false, reason: 'NO_DATA' };
  let data;
  try { data = JSON.parse(raw); } catch (_) { return { ok: false, reason: 'BAD_JSON' }; }
  if (!data || !Array.isArray(data.words)) return { ok: false, reason: 'NO_WORDS' };

  const words = [];
  for (const w of data.words) {
    if (!w || typeof w.en !== 'string' || typeof w.ko !== 'string') continue;
    const en = w.en.trim(), ko = w.ko.trim();
    if (!en || !ko) continue;
    words.push({ en, ko, pos: typeof w.pos === 'string' ? w.pos : '', nospell: w.nospell === true });
  }
  if (words.length === 0) return { ok: false, reason: 'NO_WORDS' };
  return { ok: true, title: typeof data.title === 'string' ? data.title : '', words };
}

module.exports = { extractWordData };
