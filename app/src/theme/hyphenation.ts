// `hyphens: auto` silently does nothing when the web view lacks a dictionary
// for the language; justified text then tears into wide gaps. Probe once:
// a long compound in a narrow box only fits if the engine split it.

export function probeHyphenation(lang: string): boolean {
  const el = document.createElement('div');
  el.lang = lang;
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText =
    'position:absolute;visibility:hidden;left:-9999px;top:0;width:4em;font-size:16px;hyphens:auto;-webkit-hyphens:auto;overflow:hidden;';
  el.textContent = lang.startsWith('de') ? 'Datenschutzaufsichtsbehörden' : 'internationalization';
  document.body.appendChild(el);
  const hyphenated = el.scrollWidth <= el.clientWidth + 1;
  el.remove();
  return hyphenated;
}
