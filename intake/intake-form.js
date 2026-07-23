// Shared intake-form logic: schema factory, form <-> data binding, and the
// small UI widgets (tag input, kracht table, apparatuur checklist) used by
// both the client-facing intake page and the coach dashboard. Both pages
// render the same fieldset markup (same element IDs) and import this module
// so the reading/writing logic exists exactly once.

import { escapeHtml, num } from './utils.js?v=3';

// Stable canonical keys (not translated) — these are the values actually
// stored in intake.materiaal.apparatuur, so the schema stays consistent no
// matter which language a client filled the form in. Display labels are
// looked up via `labelFn`, which defaults to Dutch (used by coach.html).
export const APPARATUUR_OPTIES = [
  'squat_rack', 'hyperextension_bench', 'chinup_belt', 'leg_curl_machine',
  'leg_extension_machine', 'trx', 'powerlifting_bands', 'powerlifting_chains',
  'adjustable_bench', 'cable_machine', 'smith_machine', 'dumbbells_50kg',
];

const STANDAARD_APPARATUUR_LABELS = {
  squat_rack: 'Squat rek',
  hyperextension_bench: 'Hyperextension bench',
  chinup_belt: 'Chin-up belt (assist)',
  leg_curl_machine: 'Leg curl machine',
  leg_extension_machine: 'Leg extension machine',
  trx: 'TRX',
  powerlifting_bands: 'Powerlifting bands',
  powerlifting_chains: 'Powerlifting chains',
  adjustable_bench: 'Verstelbare bank',
  cable_machine: 'Kabel machine',
  smith_machine: 'Smith machine',
  dumbbells_50kg: 'Dumbbells tot 50kg+',
};

export const STANDAARD_KRACHT_RIJEN = ['Bench press', 'Squat', 'Chin-up', 'Overhead press'];

// ---------- Schema factory ----------

export function maakLeegClient() {
  return {
    id: crypto.randomUUID(),
    naam: '',
    createdAt: new Date().toISOString(),
    intake: {
      persoonsgegevens: {
        naam: '', email: '', leeftijd: null, lengte: null, gewicht: null, vetpercentage: null,
        geslacht: 'man', trainingservaring: null,
      },
      huidigeKracht: STANDAARD_KRACHT_RIJEN.map((oefening) => ({ oefening, kg: 0, herhalingen: 0, sets: 0 })),
      doel: { tekst: '', categorie: 'onderhoud' },
      motivatieMindset: { motivatie: '', mentaleInstelling: '' },
      trainingsfrequentie: { huidig: 3, trainingsmomenten: [], baan: { type: '', urenZittend: null, urenStaand: null } },
      blessures: { tekst: '', vermijdenOefeningen: [] },
      dieet: { huidig: '', voorkeuren: [], afkeuren: [] },
      peds: { gebruikt: false, toelichting: '' },
      lifestyle: { activityLevel: 'sedentair', stressLevel: 'gemiddeld', slaap: { uren: null, kwaliteit: 'matig' }, cafeine: null },
      vetpercentageMeting: { huidplooimeter: false },
      materiaal: { laagstePlaat: null, dumbbellStapgrootte: null, apparatuur: [] },
      supplementen: '',
      genen: { polsomtrek: null, enkelomtrek: null, gewichtVoorheen: '', zwareBaby: false },
    },
    instellingen: {},
    calculations: null,
  };
}

// ---------- Tag input component ----------

export function initTagInput(container) {
  container.tags = [];

  function render() {
    container.innerHTML = '';
    for (const tag of container.tags) {
      const el = document.createElement('span');
      el.className = 'tag';
      el.innerHTML = `${escapeHtml(tag)} <button type="button" aria-label="Verwijder">&times;</button>`;
      el.querySelector('button').addEventListener('click', () => {
        container.tags = container.tags.filter((t) => t !== tag);
        render();
      });
      container.appendChild(el);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = container.dataset.placeholder || '';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const waarde = input.value.trim().replace(/,$/, '');
        if (waarde && !container.tags.includes(waarde)) {
          container.tags.push(waarde);
          render();
        }
      } else if (e.key === 'Backspace' && !input.value && container.tags.length) {
        container.tags.pop();
        render();
      }
    });
    container.appendChild(input);
  }

  container.setTags = (tags) => { container.tags = [...(tags ?? [])]; render(); };
  container.getTags = () => [...container.tags];
  render();
  return container;
}

export function initTagInputs() {
  for (const el of document.querySelectorAll('.tag-input')) initTagInput(el);
}

// ---------- Kracht tabel ----------

export function renderKrachtTabel(rijen) {
  const tbody = document.getElementById('kracht-tbody');
  tbody.innerHTML = '';
  for (const rij of rijen) tbody.appendChild(maakKrachtRij(rij));
}

export function maakKrachtRij(rij) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="k-oefening" value="${escapeHtml(rij.oefening)}"></td>
    <td><input type="number" step="0.5" class="k-kg" value="${rij.kg ?? 0}"></td>
    <td><input type="number" class="k-reps" value="${rij.herhalingen ?? 0}"></td>
    <td><input type="number" class="k-sets" value="${rij.sets ?? 0}"></td>
    <td><button type="button" class="btn btn--danger btn--small" data-remove-rij>&times;</button></td>
  `;
  tr.querySelector('[data-remove-rij]').addEventListener('click', () => tr.remove());
  return tr;
}

export function leesKrachtTabel() {
  return [...document.getElementById('kracht-tbody').querySelectorAll('tr')].map((tr) => ({
    oefening: tr.querySelector('.k-oefening').value.trim(),
    kg: num(tr.querySelector('.k-kg').value, 0),
    herhalingen: num(tr.querySelector('.k-reps').value, 0),
    sets: num(tr.querySelector('.k-sets').value, 0),
  })).filter((r) => r.oefening);
}

// ---------- Apparatuur checklist ----------

export function renderApparatuurChecklist(geselecteerd, labelFn = (key) => STANDAARD_APPARATUUR_LABELS[key] ?? key) {
  const el = document.getElementById('apparatuur-checklist');
  el.innerHTML = APPARATUUR_OPTIES.map((key) => `
    <label>
      <input type="checkbox" value="${escapeHtml(key)}" ${geselecteerd.includes(key) ? 'checked' : ''}>
      ${escapeHtml(labelFn(key))}
    </label>
  `).join('');
}

export function leesApparatuurChecklist() {
  return [...document.querySelectorAll('#apparatuur-checklist input:checked')].map((i) => i.value);
}

// ---------- Intake form <-> data ----------

export function vulIntakeFormIn(client, apparatuurLabelFn) {
  const i = client.intake;
  document.getElementById('f-naam').value = i.persoonsgegevens.naam;
  document.getElementById('f-email').value = i.persoonsgegevens.email ?? '';
  document.getElementById('f-leeftijd').value = i.persoonsgegevens.leeftijd ?? '';
  document.getElementById('f-lengte').value = i.persoonsgegevens.lengte ?? '';
  document.getElementById('f-gewicht').value = i.persoonsgegevens.gewicht ?? '';
  document.getElementById('f-vetpercentage').value = i.persoonsgegevens.vetpercentage ?? '';
  document.getElementById('f-geslacht').value = i.persoonsgegevens.geslacht;
  document.getElementById('f-trainingservaring').value = i.persoonsgegevens.trainingservaring ?? '';
  document.getElementById('f-huidplooimeter').checked = !!i.vetpercentageMeting.huidplooimeter;

  renderKrachtTabel(i.huidigeKracht);

  document.getElementById('f-doel-categorie').value = i.doel.categorie;
  document.getElementById('f-doel-tekst').value = i.doel.tekst;

  document.getElementById('f-motivatie').value = i.motivatieMindset?.motivatie ?? '';
  document.getElementById('f-mentale-instelling').value = i.motivatieMindset?.mentaleInstelling ?? '';

  document.getElementById('f-trainingsfrequentie').value = i.trainingsfrequentie.huidig ?? 3;
  document.getElementById('f-baan-type').value = i.trainingsfrequentie.baan.type;
  document.getElementById('f-baan-uren-zittend').value = i.trainingsfrequentie.baan.urenZittend ?? '';
  document.getElementById('f-baan-uren-staand').value = i.trainingsfrequentie.baan.urenStaand ?? '';
  document.getElementById('tags-trainingsmomenten').setTags(i.trainingsfrequentie.trainingsmomenten);

  document.getElementById('f-blessures-tekst').value = i.blessures.tekst;
  document.getElementById('tags-vermijden-oefeningen').setTags(i.blessures.vermijdenOefeningen);

  document.getElementById('f-dieet-huidig').value = i.dieet.huidig;
  document.getElementById('tags-voorkeuren').setTags(i.dieet.voorkeuren);
  document.getElementById('tags-afkeuren').setTags(i.dieet.afkeuren);

  document.getElementById('f-peds-gebruikt').checked = !!i.peds.gebruikt;
  document.getElementById('f-peds-toelichting').value = i.peds.toelichting;

  document.getElementById('f-activity-level').value = i.lifestyle.activityLevel;
  document.getElementById('f-stress-level').value = i.lifestyle.stressLevel;
  document.getElementById('f-slaap-uren').value = i.lifestyle.slaap.uren ?? '';
  document.getElementById('f-slaap-kwaliteit').value = i.lifestyle.slaap.kwaliteit;
  document.getElementById('f-cafeine').value = i.lifestyle.cafeine ?? '';

  document.getElementById('f-laagste-plaat').value = i.materiaal.laagstePlaat ?? '';
  document.getElementById('f-dumbbell-stap').value = i.materiaal.dumbbellStapgrootte ?? '';
  renderApparatuurChecklist(i.materiaal.apparatuur, apparatuurLabelFn);

  document.getElementById('f-supplementen').value = i.supplementen;

  document.getElementById('f-polsomtrek').value = i.genen.polsomtrek ?? '';
  document.getElementById('f-enkelomtrek').value = i.genen.enkelomtrek ?? '';
  document.getElementById('f-gewicht-voorheen').value = i.genen.gewichtVoorheen;
  document.getElementById('f-zware-baby').checked = !!i.genen.zwareBaby;
}

export function leesIntakeForm() {
  return {
    persoonsgegevens: {
      naam: document.getElementById('f-naam').value.trim(),
      email: document.getElementById('f-email').value.trim(),
      leeftijd: num(document.getElementById('f-leeftijd').value),
      lengte: num(document.getElementById('f-lengte').value),
      gewicht: num(document.getElementById('f-gewicht').value),
      vetpercentage: num(document.getElementById('f-vetpercentage').value),
      geslacht: document.getElementById('f-geslacht').value,
      trainingservaring: num(document.getElementById('f-trainingservaring').value),
    },
    huidigeKracht: leesKrachtTabel(),
    doel: {
      tekst: document.getElementById('f-doel-tekst').value.trim(),
      categorie: document.getElementById('f-doel-categorie').value,
    },
    motivatieMindset: {
      motivatie: document.getElementById('f-motivatie').value.trim(),
      mentaleInstelling: document.getElementById('f-mentale-instelling').value.trim(),
    },
    trainingsfrequentie: {
      huidig: num(document.getElementById('f-trainingsfrequentie').value, 3),
      trainingsmomenten: document.getElementById('tags-trainingsmomenten').getTags(),
      baan: {
        type: document.getElementById('f-baan-type').value.trim(),
        urenZittend: num(document.getElementById('f-baan-uren-zittend').value),
        urenStaand: num(document.getElementById('f-baan-uren-staand').value),
      },
    },
    blessures: {
      tekst: document.getElementById('f-blessures-tekst').value.trim(),
      vermijdenOefeningen: document.getElementById('tags-vermijden-oefeningen').getTags(),
    },
    dieet: {
      huidig: document.getElementById('f-dieet-huidig').value.trim(),
      voorkeuren: document.getElementById('tags-voorkeuren').getTags(),
      afkeuren: document.getElementById('tags-afkeuren').getTags(),
    },
    peds: {
      gebruikt: document.getElementById('f-peds-gebruikt').checked,
      toelichting: document.getElementById('f-peds-toelichting').value.trim(),
    },
    lifestyle: {
      activityLevel: document.getElementById('f-activity-level').value,
      stressLevel: document.getElementById('f-stress-level').value,
      slaap: {
        uren: num(document.getElementById('f-slaap-uren').value),
        kwaliteit: document.getElementById('f-slaap-kwaliteit').value,
      },
      cafeine: num(document.getElementById('f-cafeine').value),
    },
    vetpercentageMeting: { huidplooimeter: document.getElementById('f-huidplooimeter').checked },
    materiaal: {
      laagstePlaat: num(document.getElementById('f-laagste-plaat').value),
      dumbbellStapgrootte: num(document.getElementById('f-dumbbell-stap').value),
      apparatuur: leesApparatuurChecklist(),
    },
    supplementen: document.getElementById('f-supplementen').value.trim(),
    genen: {
      polsomtrek: num(document.getElementById('f-polsomtrek').value),
      enkelomtrek: num(document.getElementById('f-enkelomtrek').value),
      gewichtVoorheen: document.getElementById('f-gewicht-voorheen').value.trim(),
      zwareBaby: document.getElementById('f-zware-baby').checked,
    },
  };
}
