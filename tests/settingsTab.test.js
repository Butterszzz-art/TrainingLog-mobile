const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');

let dom;

beforeAll(() => {
  dom = new JSDOM(html, { runScripts: 'outside-only' });

  // implement simplified tab switching
  dom.window.showTab = function(tabName) {
    dom.window.document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    const tab = dom.window.document.getElementById(tabName);
    if (tab) tab.classList.add('active');
  };

  // Settings navigation moved into the "More" drawer — the old #sideMenu
  // a[data-target] pattern this test used to target no longer exists
  // anywhere in index.html. Current markup:
  // <button class="more-drawer-item" data-tab="settingsTab"
  //   onclick="closeMoreDrawer(); setTimeout(()=>showTab('settingsTab'), 220)">
  // Mimic that behavior synchronously (skip the animation delay — not what
  // this test is checking) rather than relying on the inline onclick
  // attribute, which doesn't execute under runScripts: 'outside-only'.
  dom.window.closeMoreDrawer = function() {};
  dom.window.document.querySelectorAll('.more-drawer-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      dom.window.closeMoreDrawer();
      dom.window.showTab(btn.getAttribute('data-tab'));
    });
  });
});

test('clicking Settings link shows settings tab', () => {
  const settingsLink = dom.window.document.querySelector('.more-drawer-item[data-tab="settingsTab"]');
  const settingsTab = dom.window.document.getElementById('settingsTab');

  expect(settingsLink).not.toBeNull();
  expect(settingsTab.classList.contains('active')).toBe(false);

  // simulate click
  settingsLink.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  expect(settingsTab.classList.contains('active')).toBe(true);
});
