import { downloadJson } from './utils.js?v=1';
import {
  maakLeegClient, initTagInputs, vulIntakeFormIn, leesIntakeForm, maakKrachtRij, renderApparatuurChecklist,
} from './intake-form.js?v=1';
import { TALEN, vertaal, apparatuurLabel } from './i18n.js?v=1';

// This page never talks to the coach dashboard directly: no client list, no
// calculations shown here, no localStorage key shared with coach.js. It only
// ever reads this one draft key, so nothing here can expose another client's
// data. The actual write goes through the Pocket Coach backend (same origin
// as coach.js talks to) rather than a separate Firebase project.
const SERVER_URL = 'https://traininglog-backend.onrender.com';
const DRAFT_KEY = 'pt-intake:client-draft:v1';
const TAAL_KEY = 'pt-intake:client-taal:v1';

let huidigClient = null;
let huidigeTaal = 'nl';
let huidigeStatusSleutel = 'status.bezig';
let laatsteBestandsnaam = '';
let conceptTimer = null;

function toonView(naam) {
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  document.getElementById(`view-${naam}`).classList.add('active');
}

function bestandsnaamVoor(client) {
  const naam = (client.intake.persoonsgegevens.naam || 'intake').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return `${naam}-intake.json`;
}

function slaConceptOp() {
  try {
    huidigClient.intake = leesIntakeForm();
    localStorage.setItem(DRAFT_KEY, JSON.stringify(huidigClient));
  } catch {
    // Form not in a readable state yet (e.g. mid-edit) — skip this autosave tick.
  }
}

// ---------- Taal (i18n) ----------

function bepaalStartTaal() {
  const opgeslagen = localStorage.getItem(TAAL_KEY);
  if (opgeslagen && TALEN.includes(opgeslagen)) return opgeslagen;
  const browserTaal = (navigator.language || 'nl').slice(0, 2).toLowerCase();
  return TALEN.includes(browserTaal) ? browserTaal : 'nl';
}

function herrenderApparatuur() {
  const geselecteerd = [...document.querySelectorAll('#apparatuur-checklist input:checked')].map((i) => i.value);
  renderApparatuurChecklist(geselecteerd, (key) => apparatuurLabel(huidigeTaal, key));
}

function pasVertalingToe(taal) {
  huidigeTaal = taal;
  document.documentElement.lang = taal;
  document.title = vertaal(taal, 'meta.title');

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = vertaal(taal, el.dataset.i18n);
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const tekst = vertaal(taal, el.dataset.i18nPlaceholder);
    if (el.classList.contains('tag-input')) {
      el.dataset.placeholder = tekst;
      el.setTags?.(el.getTags?.() ?? []);
    } else {
      el.placeholder = tekst;
    }
  });

  herrenderApparatuur();

  // The generic loop above just reset the status line to its default
  // ("saving...") text — restore whatever it actually says right now.
  document.getElementById('verzend-status').textContent = vertaal(taal, huidigeStatusSleutel);

  document.getElementById('taal-keuze').value = taal;
  localStorage.setItem(TAAL_KEY, taal);
}

// Independent of the backend write entirely — a real client submission could
// in principle report success but the write silently fail server-side, so
// this always-visible mailto link gives a second channel that doesn't depend
// on the network round-trip at all.
function mailtoLink(client, bestandsnaam) {
  const onderwerp = `${vertaal(huidigeTaal, 'header.brand')} — ${client.naam || 'Naamloos'}`;
  const body = vertaal(huidigeTaal, 'mailto.body')
    .replace('{bestand}', bestandsnaam)
    .replace('{naam}', client.naam || '');
  return `mailto:armanbahali@pocketcoachcoms.org?subject=${encodeURIComponent(onderwerp)}&body=${encodeURIComponent(body)}`;
}

function zetVerzendStatus(sleutel, variant) {
  huidigeStatusSleutel = sleutel;
  const el = document.getElementById('verzend-status');
  el.textContent = vertaal(huidigeTaal, sleutel);
  el.className = `verzend-status verzend-status--${variant}`;
}

async function verstuur() {
  huidigClient.intake = leesIntakeForm();
  huidigClient.naam = huidigClient.intake.persoonsgegevens.naam;
  laatsteBestandsnaam = bestandsnaamVoor(huidigClient);

  downloadJson(laatsteBestandsnaam, { client: huidigClient });
  localStorage.removeItem(DRAFT_KEY);

  document.getElementById('bedankt-naam').textContent = huidigClient.naam || 'daar';
  document.getElementById('bedankt-bestandsnaam').textContent = laatsteBestandsnaam;
  document.getElementById('btn-mail-backup').href = mailtoLink(huidigClient, laatsteBestandsnaam);
  zetVerzendStatus('status.bezig', 'bezig');
  toonView('bedankt');

  try {
    const res = await fetch(SERVER_URL + '/api/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intake: huidigClient.intake }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data?.error?.message || 'Request failed');
    zetVerzendStatus('status.ok', 'ok');
  } catch {
    zetVerzendStatus('status.fout', 'fout');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  pasVertalingToe(bepaalStartTaal());
  initTagInputs();

  const opgeslagenConcept = localStorage.getItem(DRAFT_KEY);
  if (opgeslagenConcept) {
    try {
      const concept = JSON.parse(opgeslagenConcept);
      if (concept?.intake && confirm(vertaal(huidigeTaal, 'confirm.eerderFormulier'))) {
        huidigClient = concept;
      }
    } catch {
      // Corrupt draft — ignore and start fresh below.
    }
  }
  if (!huidigClient) huidigClient = maakLeegClient();
  vulIntakeFormIn(huidigClient, (key) => apparatuurLabel(huidigeTaal, key));

  document.getElementById('taal-keuze').addEventListener('change', (e) => {
    pasVertalingToe(e.target.value);
  });

  document.getElementById('intake-form').addEventListener('submit', (e) => {
    e.preventDefault();
    verstuur();
  });

  document.getElementById('intake-form').addEventListener('input', () => {
    clearTimeout(conceptTimer);
    conceptTimer = setTimeout(slaConceptOp, 500);
  });

  document.getElementById('btn-kracht-rij-toevoegen').addEventListener('click', () => {
    document.getElementById('kracht-tbody').appendChild(maakKrachtRij({ oefening: '', kg: 0, herhalingen: 0, sets: 0 }));
  });

  document.getElementById('btn-opnieuw-downloaden').addEventListener('click', () => {
    downloadJson(laatsteBestandsnaam, { client: huidigClient });
  });

  document.getElementById('btn-nieuw-formulier').addEventListener('click', () => {
    localStorage.removeItem(DRAFT_KEY);
    huidigClient = maakLeegClient();
    vulIntakeFormIn(huidigClient, (key) => apparatuurLabel(huidigeTaal, key));
    toonView('form');
  });
});
