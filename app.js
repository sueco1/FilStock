(() => {
  'use strict';

  const STORAGE_KEY = 'filamentTracker.v1';

  const DEFAULT_CAPACITY = 1000;   // grams per spool
  const DEFAULT_THRESHOLD = 150;   // grams; opened rolls below this trigger the low-stock bar
  const MAX_PRINTS = 500;

  const state = {
    rolls: [],      // { id, colour, hex, material, capacity (g), grams (g left), sealed }
    prints: [],     // { id, date, name, colour, material, grams }
    threshold: DEFAULT_THRESHOLD,
    search: '',
    material: ''
  };

  const els = {
    tabs: document.querySelectorAll('.tab'),
    panels: document.querySelectorAll('.tab-panel'),
    form: document.getElementById('add-form'),
    colour: document.getElementById('add-colour'),
    hex: document.getElementById('add-hex'),
    material: document.getElementById('add-material'),
    qty: document.getElementById('add-qty'),
    status: document.getElementById('status'),
    summary: document.getElementById('summary'),
    search: document.getElementById('search'),
    materialFilter: document.getElementById('material-filter'),
    list: document.getElementById('inventory-list'),
    capacity: document.getElementById('add-capacity'),
    threshold: document.getElementById('threshold'),
    lowStock: document.getElementById('low-stock'),
    printForm: document.getElementById('print-form'),
    printRoll: document.getElementById('print-roll'),
    printGrams: document.getElementById('print-grams'),
    printName: document.getElementById('print-name'),
    printStatus: document.getElementById('print-status'),
    printSummary: document.getElementById('print-summary'),
    printList: document.getElementById('print-list')
  };

  /* ---------- Helpers ---------- */

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeHex(hex) {
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#cccccc';
  }

  function clampPercent(value) {
    const n = Math.round(Number(value));
    if (Number.isNaN(n)) return 0;
    return Math.min(100, Math.max(0, n));
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function pct(roll) {
    if (!roll.capacity) return 0;
    return Math.round((roll.grams / roll.capacity) * 100);
  }

  function clampGrams(value, capacity) {
    const n = Math.round(Number(value));
    if (Number.isNaN(n)) return 0;
    return Math.min(capacity, Math.max(0, n));
  }

  function formatCapacity(grams) {
    return grams % 1000 === 0 ? (grams / 1000) + ' kg' : grams + ' g';
  }

  // Sealed rolls group together when material, colour name and spool size match.
  function groupKey(roll) {
    return roll.material.trim().toLowerCase() + '|' + roll.colour.trim().toLowerCase() + '|' + roll.capacity;
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  /* ---------- Storage ---------- */

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.rolls)) return;
      state.rolls = parsed.rolls
        .filter(r => r && typeof r.colour === 'string' && typeof r.material === 'string')
        .map(r => {
          const sealed = r.sealed === true;
          // Older saves stored a percentage on a 1 kg spool; convert that to grams.
          const capacity = Number(r.capacity) > 0 ? Math.round(Number(r.capacity)) : DEFAULT_CAPACITY;
          let grams;
          if (sealed) {
            grams = capacity;
          } else if (typeof r.grams === 'number') {
            grams = clampGrams(r.grams, capacity);
          } else {
            grams = clampGrams((clampPercent(r.percent) / 100) * capacity, capacity);
          }
          return {
            id: typeof r.id === 'string' ? r.id : uid(),
            colour: r.colour,
            hex: safeHex(r.hex),
            material: r.material,
            capacity,
            grams,
            sealed
          };
        });
      if (Array.isArray(parsed.prints)) {
        state.prints = parsed.prints
          .filter(p => p && typeof p.grams === 'number')
          .map(p => ({
            id: typeof p.id === 'string' ? p.id : uid(),
            date: typeof p.date === 'string' ? p.date : '',
            name: typeof p.name === 'string' ? p.name : '',
            colour: typeof p.colour === 'string' ? p.colour : '',
            material: typeof p.material === 'string' ? p.material : '',
            grams: p.grams
          }));
      }
      if (typeof parsed.threshold === 'number' && parsed.threshold >= 0) {
        state.threshold = parsed.threshold;
      }
    } catch (err) {
      console.warn('Could not load saved inventory:', err);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        rolls: state.rolls,
        prints: state.prints,
        threshold: state.threshold
      }));
    } catch (err) {
      console.warn('Could not save inventory:', err);
    }
  }

  /* ---------- Data operations ---------- */

  function addSealedRolls(colour, hex, material, qty, capacity) {
    const key = colour.trim().toLowerCase();
    const mat = material.trim();
    const probe = { colour: colour.trim(), material: mat, capacity };
    // Reuse the shade of an existing sealed group so the group stays visually consistent.
    const existing = state.rolls.find(r => r.sealed && groupKey(r) === groupKey(probe));
    const useHex = existing ? existing.hex : safeHex(hex);

    for (let i = 0; i < qty; i++) {
      state.rolls.push({
        id: uid(),
        colour: colour.trim(),
        hex: useHex,
        material: mat,
        capacity,
        grams: capacity,
        sealed: true
      });
    }
    return key;
  }

  function findRoll(id) {
    return state.rolls.find(r => r.id === id);
  }

  function findSealedInGroup(key) {
    return state.rolls.find(r => r.sealed && groupKey(r) === key);
  }

  function removeRoll(id) {
    state.rolls = state.rolls.filter(r => r.id !== id);
  }

  /* ---------- Rendering ---------- */

  function spoolSvg(percent, hex, centerText) {
    const r = 34;
    const circumference = 2 * Math.PI * r;
    const len = (circumference * percent) / 100;
    const dash = len.toFixed(2) + ' ' + circumference.toFixed(2);
    const arc = percent > 0
      ? '<circle class="spool-edge" cx="44" cy="44" r="' + r + '" stroke-dasharray="' + dash + '" transform="rotate(-90 44 44)"/>' +
        '<circle class="spool-arc" cx="44" cy="44" r="' + r + '" style="stroke:' + safeHex(hex) + '" stroke-dasharray="' + dash + '" transform="rotate(-90 44 44)"/>'
      : '';
    return '<svg class="spool" viewBox="0 0 88 88" aria-hidden="true">' +
      '<circle class="spool-track" cx="44" cy="44" r="' + r + '"/>' +
      arc +
      '<circle class="spool-hub" cx="44" cy="44" r="22"/>' +
      '<text class="spool-label" x="44" y="48.5">' + esc(centerText) + '</text>' +
      '</svg>';
  }

  function groupCardHtml(key, rolls) {
    const first = rolls[0];
    const n = rolls.length;
    return '<article class="roll is-group" data-key="' + esc(key) + '">' +
      '<div class="spool-wrap">' + spoolSvg(100, first.hex, '×' + n) + '</div>' +
      '<div class="roll-body">' +
        '<div class="roll-top">' +
          '<h3 title="' + esc(first.colour) + '">' + esc(first.colour) + '</h3>' +
          '<span class="material">' + esc(first.material) + '</span>' +
        '</div>' +
        '<p class="meta">' + plural(n, 'sealed roll') + ' · ' + formatCapacity(first.capacity) + ' each</p>' +
        '<div class="group-actions">' +
          '<button type="button" class="btn btn-small" data-action="group-remove" aria-label="Remove one sealed ' + esc(first.colour) + ' roll">Remove one</button>' +
          '<button type="button" class="btn btn-small" data-action="group-add" aria-label="Add one sealed ' + esc(first.colour) + ' roll">Add one</button>' +
        '</div>' +
        '<div class="control-row">' +
          '<input type="range" min="0" max="' + first.capacity + '" step="1" value="' + first.capacity + '" data-role="group-open" aria-label="Open one roll: set grams remaining">' +
          '<span class="unit"><span class="group-open-val">' + first.capacity + '</span> g <span class="pct-label">(100%)</span></span>' +
        '</div>' +
        '<p class="hint">Drag the slider down to open one roll.</p>' +
      '</div>' +
    '</article>';
  }

  function rollCardHtml(r) {
    return '<article class="roll' + (r.grams === 0 ? ' is-empty' : '') + '" data-id="' + esc(r.id) + '">' +
      '<div class="spool-wrap">' + spoolSvg(pct(r), r.hex, pct(r) + '%') + '</div>' +
      '<div class="roll-body">' +
        '<div class="roll-top">' +
          '<h3 title="' + esc(r.colour) + '">' + esc(r.colour) + '</h3>' +
          '<span class="material">' + esc(r.material) + '</span>' +
          '<button type="button" class="icon-btn" data-action="roll-remove" aria-label="Remove this ' + esc(r.colour) + ' roll" title="Remove roll">✕</button>' +
        '</div>' +
        '<div class="control-row">' +
          '<input type="range" min="0" max="' + r.capacity + '" step="1" value="' + r.grams + '" data-role="grams" aria-label="Grams remaining">' +
          '<input type="number" min="0" max="' + r.capacity + '" step="1" value="' + r.grams + '" data-role="grams-num" aria-label="Grams remaining (number)">' +
          '<span class="unit">g</span>' +
        '</div>' +
        '<p class="meta"><span class="pct-label">' + pct(r) + '%</span> of ' + formatCapacity(r.capacity) + '</p>' +
        (r.grams === r.capacity
          ? '<div><button type="button" class="btn btn-small" data-action="roll-seal">Mark as sealed</button></div>'
          : '') +
      '</div>' +
    '</article>';
  }

  function matchesFilters(r) {
    if (state.material && r.material.trim().toLowerCase() !== state.material) return false;
    if (state.search) {
      const hay = (r.colour + ' ' + r.material).toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  }

  function refreshMaterialFilter() {
    const seen = new Map();
    state.rolls.forEach(r => {
      const k = r.material.trim().toLowerCase();
      if (!seen.has(k)) seen.set(k, r.material.trim());
    });
    const options = ['<option value="">All materials</option>']
      .concat(Array.from(seen.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([k, label]) => '<option value="' + esc(k) + '">' + esc(label) + '</option>'));
    // If the selected material no longer exists, fall back to all.
    if (state.material && !seen.has(state.material)) state.material = '';
    els.materialFilter.innerHTML = options.join('');
    els.materialFilter.value = state.material;
  }

  function render() {
    refreshMaterialFilter();
    renderLowStock();
    renderPrintForm();
    renderPrintLog();
    els.threshold.value = state.threshold;

    const total = state.rolls.length;
    const sealedCount = state.rolls.filter(r => r.sealed).length;
    els.summary.textContent = total === 0
      ? 'No rolls yet'
      : plural(total, 'roll') + ' · ' + sealedCount + ' sealed · ' + (total - sealedCount) + ' opened';

    const visible = state.rolls.filter(matchesFilters);

    if (total === 0) {
      els.list.innerHTML = '<div class="empty-state">Your inventory is empty. Add a roll above to get started.</div>';
      return;
    }
    if (visible.length === 0) {
      els.list.innerHTML = '<div class="empty-state">No rolls match your search.</div>';
      return;
    }

    const groups = new Map();
    const opened = [];
    visible.forEach(r => {
      if (r.sealed) {
        const k = groupKey(r);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
      } else {
        opened.push(r);
      }
    });

    const groupList = Array.from(groups.entries())
      .sort((a, b) => a[1][0].colour.localeCompare(b[1][0].colour) ||
                      a[1][0].material.localeCompare(b[1][0].material));

    opened.sort((a, b) =>
      a.grams / a.capacity - b.grams / b.capacity || a.colour.localeCompare(b.colour));

    let html = '';

    if (opened.length) {
      html += '<section class="inv-section"><h2>Opened <span class="count">' + opened.length + '</span></h2>' +
        '<div class="grid">' + opened.map(rollCardHtml).join('') + '</div></section>';
    }
    if (groupList.length) {
      const sealedTotal = groupList.reduce((sum, g) => sum + g[1].length, 0);
      html += '<section class="inv-section"><h2>Sealed <span class="count">' + sealedTotal + '</span></h2>' +
        '<div class="grid">' + groupList.map(([k, rolls]) => groupCardHtml(k, rolls)).join('') + '</div></section>';
    }

    els.list.innerHTML = html;
  }

  // Update one opened roll's card in place (keeps focus while dragging/typing).
  function updateRollView(card, roll, skipNumber) {
    const percent = pct(roll);
    card.querySelector('.spool-wrap').innerHTML = spoolSvg(percent, roll.hex, percent + '%');
    card.classList.toggle('is-empty', roll.grams === 0);
    card.querySelector('.pct-label').textContent = percent + '%';
    const range = card.querySelector('[data-role="grams"]');
    if (range) range.value = roll.grams;
    if (!skipNumber) {
      const num = card.querySelector('[data-role="grams-num"]');
      if (num) num.value = roll.grams;
    }
    renderLowStock();
  }

  function setStatus(message) {
    els.status.textContent = message;
  }

  function setPrintStatus(message) {
    els.printStatus.textContent = message;
  }

  /* ---------- Low-stock bar ---------- */

  function renderLowStock() {
    const low = state.rolls
      .filter(r => !r.sealed && r.grams < state.threshold)
      .sort((a, b) => a.grams - b.grams);
    if (!low.length) {
      els.lowStock.hidden = true;
      els.lowStock.innerHTML = '';
      return;
    }
    const items = low.map(r =>
      esc(r.colour + ' ' + r.material) + ' (' + (r.grams === 0 ? 'empty' : r.grams + ' g') + ')'
    ).join(', ');
    els.lowStock.innerHTML = '<strong>⚠ ' + plural(low.length, 'roll') + ' running low:</strong> ' + items;
    els.lowStock.hidden = false;
  }

  /* ---------- Print log ---------- */

  function renderPrintForm() {
    const previous = els.printRoll.value;
    const opened = state.rolls
      .filter(r => !r.sealed && r.grams > 0)
      .sort((a, b) => a.colour.localeCompare(b.colour) || a.grams - b.grams);
    const groups = new Map();
    state.rolls.filter(r => r.sealed).forEach(r => {
      const k = groupKey(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    });

    let html = '';
    if (opened.length) {
      html += '<optgroup label="Opened rolls">' + opened.map(r =>
        '<option value="roll:' + esc(r.id) + '">' + esc(r.colour + ' ' + r.material) + ' — ' + r.grams + ' g left</option>'
      ).join('') + '</optgroup>';
    }
    if (groups.size) {
      html += '<optgroup label="Sealed (opens a new roll)">' +
        Array.from(groups.entries()).map(([k, rolls]) =>
          '<option value="group:' + esc(k) + '">' + esc(rolls[0].colour + ' ' + rolls[0].material) +
          ' — ' + formatCapacity(rolls[0].capacity) + ', ×' + rolls.length + ' sealed</option>'
        ).join('') + '</optgroup>';
    }

    els.printRoll.innerHTML = html || '<option value="">No rolls available</option>';
    if (previous && Array.from(els.printRoll.options).some(o => o.value === previous)) {
      els.printRoll.value = previous;
    }
    els.printForm.querySelector('button[type="submit"]').disabled = !html;
  }

  function renderPrintLog() {
    const n = state.prints.length;
    const total = state.prints.reduce((sum, p) => sum + p.grams, 0);
    els.printSummary.textContent = n === 0 ? 'No prints logged yet' : plural(n, 'print') + ' · ' + total + ' g used';
    if (n === 0) {
      els.printList.innerHTML = '<div class="empty-state">Log a print to take filament off a roll.</div>';
      return;
    }
    els.printList.innerHTML = '<ul class="print-log">' + state.prints.map(p => {
      const d = new Date(p.date);
      const when = isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ';
      return '<li class="print-item" data-id="' + esc(p.id) + '">' +
        '<div class="print-main"><strong>' + esc(p.name || 'Untitled print') + '</strong>' +
        '<p class="meta">' + esc(when + p.colour + ' ' + p.material) + '</p></div>' +
        '<span class="print-grams">' + p.grams + ' g</span>' +
        '<button type="button" class="icon-btn" data-action="print-remove" aria-label="Remove log entry" title="Remove log entry">✕</button>' +
        '</li>';
    }).join('') + '</ul>';
  }

  els.printForm.addEventListener('submit', event => {
    event.preventDefault();
    const choice = els.printRoll.value;
    const grams = Math.round(Number(els.printGrams.value));
    if (!choice || !(grams > 0)) {
      els.printGrams.focus();
      return;
    }
    const roll = choice.startsWith('group:')
      ? findSealedInGroup(choice.slice(6))
      : findRoll(choice.slice(5));
    if (!roll) {
      setPrintStatus('That roll is no longer in your inventory.');
      render();
      return;
    }
    if (grams > roll.grams) {
      setPrintStatus('Only ' + roll.grams + ' g left on that roll. Enter a smaller amount.');
      els.printGrams.focus();
      return;
    }
    roll.sealed = false;
    roll.grams -= grams;
    state.prints.unshift({
      id: uid(),
      date: new Date().toISOString(),
      name: els.printName.value.trim(),
      colour: roll.colour,
      material: roll.material,
      grams
    });
    if (state.prints.length > MAX_PRINTS) state.prints.length = MAX_PRINTS;
    save();
    render();
    setPrintStatus('Logged ' + grams + ' g. ' + roll.colour + ' ' + roll.material + ' now has ' + roll.grams + ' g left (' + pct(roll) + '%).');
    els.printGrams.value = '';
    els.printName.value = '';
    els.printGrams.focus();
  });

  els.printList.addEventListener('click', event => {
    const btn = event.target.closest('[data-action="print-remove"]');
    if (!btn) return;
    const item = btn.closest('.print-item');
    if (!item) return;
    state.prints = state.prints.filter(p => p.id !== item.dataset.id);
    save();
    renderPrintLog();
  });

  els.threshold.addEventListener('input', () => {
    if (els.threshold.value === '') return;
    state.threshold = Math.max(0, Math.round(Number(els.threshold.value)) || 0);
    save();
    renderLowStock();
  });

  /* ---------- Events ---------- */

  els.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.tab;
      els.tabs.forEach(t => {
        const active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      });
      els.panels.forEach(p => p.classList.toggle('is-active', p.id === 'tab-' + name));
      render();
    });
  });

  els.form.addEventListener('submit', event => {
    event.preventDefault();
    const colour = els.colour.value.trim();
    const material = els.material.value.trim() || 'PLA';
    const qty = Math.min(50, Math.max(1, parseInt(els.qty.value, 10) || 1));
    const capacity = Math.min(10000, Math.max(1, parseInt(els.capacity.value, 10) || DEFAULT_CAPACITY));
    if (!colour) {
      els.colour.focus();
      return;
    }
    addSealedRolls(colour, els.hex.value, material, qty, capacity);
    save();
    render();
    setStatus('Added ' + plural(qty, 'sealed roll') + ': ' + material + ' ' + colour + '.');
    els.colour.value = '';
    els.qty.value = 1;
    els.colour.focus();
  });

  els.search.addEventListener('input', () => {
    state.search = els.search.value.trim().toLowerCase();
    render();
  });

  els.materialFilter.addEventListener('change', () => {
    state.material = els.materialFilter.value;
    render();
  });

  els.list.addEventListener('click', event => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const card = btn.closest('.roll');
    if (!card) return;

    if (action === 'group-add') {
      const key = card.dataset.key;
      const template = findSealedInGroup(key);
      if (!template) return;
      state.rolls.push({
        id: uid(),
        colour: template.colour,
        hex: template.hex,
        material: template.material,
        capacity: template.capacity,
        grams: template.capacity,
        sealed: true
      });
    } else if (action === 'group-remove') {
      const target = findSealedInGroup(card.dataset.key);
      if (!target) return;
      removeRoll(target.id);
    } else if (action === 'roll-remove') {
      const roll = findRoll(card.dataset.id);
      if (!roll) return;
      if (!window.confirm('Remove this ' + roll.material + ' ' + roll.colour + ' roll?')) return;
      removeRoll(roll.id);
    } else if (action === 'roll-seal') {
      const roll = findRoll(card.dataset.id);
      if (!roll) return;
      roll.sealed = true;
      roll.grams = roll.capacity;
    } else {
      return;
    }

    save();
    render();
  });

  els.list.addEventListener('input', event => {
    const input = event.target;
    const role = input.dataset.role;
    const card = input.closest('.roll');
    if (!role || !card) return;

    if (role === 'group-open') {
      const cap = Number(input.max) || DEFAULT_CAPACITY;
      card.querySelector('.group-open-val').textContent = input.value;
      card.querySelector('.pct-label').textContent = '(' + Math.round((Number(input.value) / cap) * 100) + '%)';
      return;
    }

    const roll = findRoll(card.dataset.id);
    if (!roll) return;

    if (role === 'grams') {
      roll.grams = clampGrams(input.value, roll.capacity);
      updateRollView(card, roll, false);
      save();
    } else if (role === 'grams-num') {
      if (input.value === '') return; // still typing
      roll.grams = clampGrams(input.value, roll.capacity);
      updateRollView(card, roll, true);
      save();
    }
  });

  els.list.addEventListener('change', event => {
    const input = event.target;
    const role = input.dataset.role;
    const card = input.closest('.roll');
    if (!role || !card) return;

    if (role === 'group-open') {
      const roll = findSealedInGroup(card.dataset.key);
      if (!roll) return;
      const value = clampGrams(input.value, roll.capacity);
      if (value >= roll.capacity) return;
      roll.sealed = false;
      roll.grams = value;
      save();
      render();
    } else if (role === 'grams-num') {
      const roll = findRoll(card.dataset.id);
      if (!roll) return;
      roll.grams = clampGrams(input.value, roll.capacity);
      input.value = roll.grams;
      updateRollView(card, roll, false);
      save();
    }
  });

  /* ---------- Number steppers ---------- */

  function enhanceNumberInputs(root) {
    root.querySelectorAll('input[type="number"]').forEach(input => {
      if (input.parentElement.classList.contains('stepper')) return;
      const wrap = document.createElement('span');
      wrap.className = 'stepper';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      wrap.insertAdjacentHTML('afterbegin',
        '<button type="button" class="step-btn" data-step="-1" tabindex="-1" aria-label="Decrease">−</button>');
      wrap.insertAdjacentHTML('beforeend',
        '<button type="button" class="step-btn" data-step="1" tabindex="-1" aria-label="Increase">+</button>');
    });
  }

  document.addEventListener('click', event => {
    const btn = event.target.closest('.step-btn');
    if (!btn) return;
    const input = btn.parentElement.querySelector('input');
    if (!input || input.disabled) return;
    if (btn.dataset.step === '1') input.stepUp(); else input.stepDown();
    // Fire the same events typing would, so existing handlers react.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Roll cards are re-rendered often; wrap their number inputs as they appear.
  new MutationObserver(() => enhanceNumberInputs(els.list))
    .observe(els.list, { childList: true, subtree: true });
  enhanceNumberInputs(document);

  /* ---------- Init ---------- */

  load();
  render();
})();
