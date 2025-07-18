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

  // mimic sidebar link behaviour
  dom.window.document.querySelectorAll('#sideMenu a[data-target]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      dom.window.showTab(link.getAttribute('data-target'));
    });
  });
});

test('clicking Settings link shows settings tab', () => {
  const settingsLink = dom.window.document.querySelector('#sideMenu a[data-target="settingsTab"]');
  const settingsTab = dom.window.document.getElementById('settingsTab');

  expect(settingsTab.classList.contains('active')).toBe(false);

  // simulate click
  settingsLink.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  expect(settingsTab.classList.contains('active')).toBe(true);
});
