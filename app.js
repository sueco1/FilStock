(() => {
  'use strict';

  const STORAGE_KEY = 'filamentTracker.v1';

  const state = {
    rolls: [],      // { id, colour, hex, material, percent, sealed }
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
    list: document.getElementById('inventory-list')
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

  // Sealed rolls group together when material and colour name match.
  function groupKey(roll) {
    return roll.material.trim().toLowerCase() + '|' + roll.colour.trim().toLowerCase();
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
          return {
            id: typeof r.id === 'string' ? r.id : uid(),
            colour: r.colour,
            hex: safeHex(r.hex),
            material: r.material,
            percent: sealed ? 100 : clampPercent(r.percent),
            sealed
          };
        });
    } catch (err) {
      console.warn('Could not load saved inventory:', err);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ rolls: state.rolls }));
    } catch (err) {
      console.warn('Could not save inventory:', err);
    }
  }

  /* ---------- Data operations ---------- */

  function addSealedRolls(colour, hex, material, qty) {
    const key = colour.trim().toLowerCase();
    const mat = material.trim();
    const probe = { colour: colour.trim(), material: mat };
    // Reuse the shade of an existing sealed group so the group stays visually consistent.
    const existing = state.rolls.find(r => r.sealed && groupKey(r) === groupKey(probe));
    const useHex = existing ? existing.hex : safeHex(hex);

    for (let i = 0; i < qty; i++) {
      state.rolls.push({
        id: uid(),
        colour: colour.trim(),
        hex: useHex,
        material: mat,
        percent: 100,
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
        '<p class="meta">' + plural(n, 'sealed roll') + '</p>' +
        '<div class="group-actions">' +
          '<button type="button" class="btn btn-small" data-action="group-remove" aria-label="Remove one sealed ' + esc(first.colour) + ' roll">Remove one</button>' +
          '<button type="button" class="btn btn-small" data-action="group-add" aria-label="Add one sealed ' + esc(first.colour) + ' roll">Add one</button>' +
        '</div>' +
        '<div class="control-row">' +
          '<input type="range" min="0" max="100" step="1" value="100" data-role="group-open" aria-label="Open one roll: set percent remaining">' +
          '<span class="unit"><span class="group-open-val">100</span>%</span>' +
        '</div>' +
        '<p class="hint">Drag below 100% to open one roll.</p>' +
      '</div>' +
    '</article>';
  }

  function rollCardHtml(r) {
    return '<article class="roll' + (r.percent === 0 ? ' is-empty' : '') + '" data-id="' + esc(r.id) + '">' +
      '<div class="spool-wrap">' + spoolSvg(r.percent, r.hex, r.percent + '%') + '</div>' +
      '<div class="roll-body">' +
        '<div class="roll-top">' +
          '<h3 title="' + esc(r.colour) + '">' + esc(r.colour) + '</h3>' +
          '<span class="material">' + esc(r.material) + '</span>' +
          '<button type="button" class="icon-btn" data-action="roll-remove" aria-label="Remove this ' + esc(r.colour) + ' roll" title="Remove roll">✕</button>' +
        '</div>' +
        '<div class="control-row">' +
          '<input type="range" min="0" max="100" step="1" value="' + r.percent + '" data-role="percent" aria-label="Percent remaining">' +
          '<input type="number" min="0" max="100" step="1" value="' + r.percent + '" data-role="percent-num" aria-label="Percent remaining (number)">' +
          '<span class="unit">%</span>' +
        '</div>' +
        (r.percent === 100
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
      a.percent - b.percent || a.colour.localeCompare(b.colour));

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
    card.querySelector('.spool-wrap').innerHTML = spoolSvg(roll.percent, roll.hex, roll.percent + '%');
    card.classList.toggle('is-empty', roll.percent === 0);
    const range = card.querySelector('[data-role="percent"]');
    if (range) range.value = roll.percent;
    if (!skipNumber) {
      const num = card.querySelector('[data-role="percent-num"]');
      if (num) num.value = roll.percent;
    }
  }

  function setStatus(message) {
    els.status.textContent = message;
  }

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
    });
  });

  els.form.addEventListener('submit', event => {
    event.preventDefault();
    const colour = els.colour.value.trim();
    const material = els.material.value.trim() || 'PLA';
    const qty = Math.min(50, Math.max(1, parseInt(els.qty.value, 10) || 1));
    if (!colour) {
      els.colour.focus();
      return;
    }
    addSealedRolls(colour, els.hex.value, material, qty);
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
        percent: 100,
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
      roll.percent = 100;
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
      card.querySelector('.group-open-val').textContent = input.value;
      return;
    }

    const roll = findRoll(card.dataset.id);
    if (!roll) return;

    if (role === 'percent') {
      roll.percent = clampPercent(input.value);
      updateRollView(card, roll, false);
      save();
    } else if (role === 'percent-num') {
      if (input.value === '') return; // still typing
      roll.percent = clampPercent(input.value);
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
      const value = clampPercent(input.value);
      if (value >= 100) return;
      const roll = findSealedInGroup(card.dataset.key);
      if (!roll) return;
      roll.sealed = false;
      roll.percent = value;
      save();
      render();
    } else if (role === 'percent-num') {
      const roll = findRoll(card.dataset.id);
      if (!roll) return;
      roll.percent = clampPercent(input.value);
      input.value = roll.percent;
      updateRollView(card, roll, false);
      save();
    }
  });

  /* ---------- Init ---------- */

  load();
  render();
})();