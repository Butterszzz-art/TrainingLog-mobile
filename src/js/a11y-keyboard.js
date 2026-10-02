// Keyboard access for clickable elements that aren't real <button>s.
// Anything marked role="button" (with tabindex="0" so it can be focused)
// activates on Enter or Space, like a native button.
(function () {
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target;
    if (!el || el.tagName === 'BUTTON' || el.tagName === 'A' || el.isContentEditable) return;
    if (el.getAttribute && el.getAttribute('role') === 'button') {
      e.preventDefault();
      el.click();
    }
  });
})();
