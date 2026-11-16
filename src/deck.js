/*! deckfile v0.5.0 · engine · MIT License · https://github.com/roaldnefs/deckfile
  A presentation as one self-contained HTML file: no build step, no dependencies, opens offline from file://.

  Keys:  → / Space / PgDn  next build or slide     ← / PgUp  previous
         ↓ / ↑  next / previous slide, all builds shown
         Home / End  first / last slide
         F fullscreen   P print to PDF
         S presenter view, in a second window     E edit view     Esc leave the edit view
         in the edit view: N notes pane   Cmd/Ctrl+S save   Cmd/Ctrl+Z undo   Cmd/Ctrl+↑ / ↓ move the slide
         click / tap: left 30 % of the screen back, the rest forward · swipe left / right on touch
         pointer near the bottom-left corner: buttons for back, the presenter view, the edit view, the shortcuts and forward

  Markup:
    <div id="stage"> holding one <section class="slide"> per slide, in order
    <div class="s-notes"> inside a slide   speaker notes, shown in the presenter and edit views
    class="build" on any element        revealed one at a time with →
    data-auto="500" on a section       its builds reveal by themselves, one every 500 ms
    data-skip on a section             left out of the show, its numbers and the print; the edit view still shows it
                                        (on a detail: it does not open in the show and has no page in the print)
    data-detail="id" on any element     a click opens <aside class="detail" id="id"> of the same slide; Esc, ← or a click
                                        outside closes it, → closes it and goes on. Print gives each detail a page after its slide
    data-public on the stage           a public copy made in the edit view, to hand out: it has no edit view
  Languages: data-langs="en fr" on <html> lists the languages of the deck, the first one shown unless another was chosen.
    lang="fr" on any element in a slide or in the notes   shown only in French; elements side by side, one per language,
                                        are versions of the same text. Text without lang shows in every language.
    data-set-lang="fr" on a button      a click shows the deck in French; L switches language too
    data-fr="…" on <title>              the title of the page in French
  The engine sets .current on the slide shown, .on on each build revealed and .open on the detail shown, and adds a
  <span class="counter"> to every slide and a <button class="detail-close"> to every detail.
  URL: ?print opens the print dialog once loaded; ?presenter is the presenter window; ?view is one read-only slide, used
  for the presenter's panes and the edit view's thumbnails and layout previews.
  The README describes the presenter and edit views.
*/
(() => {
  const local0 = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const slides = [...document.querySelectorAll('.slide')];
  // made here, placed by the presenter and edit views
  const notes = Object.assign(document.body.appendChild(document.createElement('div')), { id: 'notes', hidden: true });
  const timer = Object.assign(document.createElement('div'), { id: 'timer', textContent: '00:00' });
  // ?presenter is the window that S opens, ?view is one read-only slide in an iframe; anything else is the deck
  const params = new URLSearchParams(location.search);
  const mode = params.has('presenter') ? 'presenter' : params.has('view') ? 'view' : 'deck';
  const canEdit = mode === 'deck' && !document.querySelector('#stage[data-public]');  // a public copy has no edit view
  const here = location.href.split(/[?#]/)[0];
  const KEY = 'deck:' + location.pathname;
  // the languages of the deck, and the one shown: from ?lang=, or as chosen last in this browser, or else the first
  const root = document.documentElement, langs = (root.dataset.langs || '').split(/\s+/).filter(Boolean);
  const LANG_KEY = KEY + ':lang', ownLang = root.getAttribute('lang'), titleEl = document.querySelector('title'), ownTitle = titleEl?.textContent;
  let cur = [params.get('lang'), local0(LANG_KEY), langs[0]].find(l => langs.includes(l));
  const EDIT_KEY = KEY + ':edit';
  const MODE_KEY = KEY + ':mode';
  const store = {
    get: (key = KEY) => { try { return sessionStorage.getItem(key); } catch { return null; } },
    set: (v, key = KEY) => { try { sessionStorage.setItem(key, v); } catch {} }
  };
  const local = {
    get: key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
    set: (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const builds = s => [...s.querySelectorAll('.build')];
  const skips = s => s?.dataset.skip !== undefined;
  const shown = () => slides.filter(s => !skips(s));
  let i = Math.min(+store.get() || 0, slides.length - 1);
  let det = -1;             // the detail open on the current slide, by its place among the slide's details, or -1
  let autoTimer = null;
  let presenterWin = null;  // deck: the presenter window, once it has said hello
  let pv = null;            // presenter: its panes and labels
  let editing = false;      // deck: edit mode (E) is on
  let suggesting = store.get(MODE_KEY) === 'suggest';  // deck: the edit view is in Suggest mode
  const elementIds = new WeakMap();  // deck: an id shared by an element and its copies; see twin
  let lastElementId = 0;
  const leads = new WeakMap();  // deck: the whitespace and comment before each slide, kept while the slide is out of the deck
  const HOME = Symbol('home');  // deck: key for the slide a suggestion belongs to; a symbol, so it stays out of localStorage
  let ed = null;            // deck: the edit panel, overlay and suggestions, built the first time E is pressed
  // the edit view's panes around the slide, in px
  const RAIL_W = 216, PANE_W = 320, BAR_H = 52, STATUS_H = 32, NOTES_H = 160, GAP = 24;
  let railOn = true, paneOn = true;  // the side panes of the edit view are showing
  const OFF_SLIDE = '.counter, .s-notes, .detail-close';  // inside a slide, but not part of what it shows
  // a slide's details, in document order, and the speaker notes of a slide or a detail: a slide's own are those outside its details
  const details = s => [...s.querySelectorAll('.detail')];
  const notesOf = owner => owner.matches('.detail') ? owner.querySelector('.s-notes')
    : [...owner.querySelectorAll('.s-notes')].find(n => !n.closest('.detail'));
  const openDetail = () => det < 0 ? null : details(slides[i])[det];

  // Languages. An element with a language of the deck is one version of a text; the versions of one text are the elements
  // side by side, with only white space or comments between them, that each have a language of the deck. Each shows only in
  // its language. A text without a version in the language shown shows in the first language, or else in the one it has,
  // marked data-lang-missing for the edit view, so that the show has no holes. Slides themselves are not switched
  const versioned = el => langs.length > 1 && el?.nodeType === Node.ELEMENT_NODE && langs.includes(el.getAttribute('lang')) && !el.matches('.slide, #stage');
  const langOf = el => el.getAttribute('lang');
  const blank = n => n && (n.nodeType === Node.COMMENT_NODE || (n.nodeType === Node.TEXT_NODE && !n.data.trim()));
  // A run of such elements splits where a language comes back: en fr en is one text in two languages, then one in English
  function versionsAround(el) {
    const near = (n, step) => { do n = step < 0 ? n.previousSibling : n.nextSibling; while (blank(n)); return n; };
    let first = el;
    for (let n = near(first, -1); versioned(n); n = near(n, -1)) first = n;
    const groups = [[first]];
    for (let n = near(first, 1); versioned(n); n = near(n, 1)) {
      if (groups.at(-1).some(x => langOf(x) === langOf(n))) groups.push([]);
      groups.at(-1).push(n);
    }
    return groups.find(g => g.includes(el));
  }
  function markLang(within) {
    within.querySelectorAll('[data-lang-off], [data-lang-missing]').forEach(x => { x.removeAttribute('data-lang-off'); x.removeAttribute('data-lang-missing'); });
    if (langs.length < 2) return;
    const seen = new Set();
    within.querySelectorAll('[lang]').forEach(el => {
      if (seen.has(el) || !versioned(el)) return;
      const run = versionsAround(el), has = l => run.some(x => langOf(x) === l);
      const showing = has(cur) ? cur : has(langs[0]) ? langs[0] : langOf(run[0]);
      run.forEach(x => {
        seen.add(x);
        if (langOf(x) !== showing) x.setAttribute('data-lang-off', '');
        else if (showing !== cur) x.setAttribute('data-lang-missing', '');
      });
    });
  }
  // the page in the language shown: its versions, its title, its lang, and the buttons that choose it
  function drawLang() {
    if (langs.length < 2) return;
    root.lang = cur;
    const title = titleEl?.dataset[cur] ?? ownTitle;
    if (titleEl) document.title = (root.classList.contains('presenter') ? 'Presenter: ' : '') + title;
    markLang(document.body);
    document.querySelectorAll('[data-set-lang]').forEach(b => b.setAttribute('aria-pressed', b.dataset.setLang === cur));
  }
  // show the deck in language l; the deck window remembers it, and the presenter view and the thumbnails follow
  function setLang(l) {
    if (!langs.includes(l) || l === cur) return;
    cur = l;
    if (mode === 'deck') local.set(LANG_KEY, l);
    drawLang();
    drawNotes();
    if (editing) {
      drawEdit();
      slides.forEach((s, n) => sendThumb(n));
    }
    sync();
  }
  const nextLang = () => langs[(langs.indexOf(cur) + 1) % langs.length];
  drawLang();

  // the slide number, in a <span class="counter"> the engine appends to every slide; skipped slides have none and are not counted
  function renumber() {
    const all = shown();
    slides.forEach(s => {
      const c = s.querySelector(':scope > .counter:last-child') || s.appendChild(Object.assign(document.createElement('span'), { className: 'counter' }));
      c.textContent = skips(s) ? '' : `${all.indexOf(s) + 1} / ${all.length}`;
    });
  }
  renumber();

  // the notes of the open detail, or of the slide; outside the edit view a detail without notes shows those of its slide
  function drawNotes() {
    const shown = openDetail(), own = notesOf(shown || slides[i]);
    notes.innerHTML = own?.innerHTML || (!editing && shown && notesOf(slides[i])?.innerHTML) ||
      `<em>No notes for this ${shown ? 'detail' : 'slide'}.</em>`;
    markLang(notes);
  }
  // mark the open detail and the elements that open it; each detail gets its close button, left out of the file on save
  // An opener has aria-expanded only while its detail is there to open: not for a missing or skipped detail, which it
  // then does not open, so the theme can style [data-detail][aria-expanded] as something to click
  function drawDetails() {
    const all = details(slides[i]);
    if (det >= all.length || (!editing && skips(all[det]))) det = -1;
    document.querySelectorAll('.detail.open').forEach(x => x.classList.remove('open'));
    all.forEach((x, k) => {
      x.classList.toggle('open', k === det);
      if (!x.querySelector(':scope > .detail-close')) {
        x.append(Object.assign(document.createElement('button'), { type: 'button', className: 'detail-close', innerHTML: icon('close', 24) }));
        x.lastChild.setAttribute('aria-label', 'Close');
      }
    });
    slides.forEach(s => {
      const live = new Map(details(s).filter(x => !skips(x)).map(x => [x.id, x]));
      s.querySelectorAll('[data-detail]').forEach(o => live.has(o.dataset.detail)
        ? o.setAttribute('aria-expanded', live.get(o.dataset.detail) === all[det]) : o.removeAttribute('aria-expanded'));
    });
  }
  // open the k-th detail of the current slide, or close it with -1; the builds stay as they are
  function setDetail(k) {
    if (editing) return show(i, true, k);
    det = k;
    drawDetails();
    drawNotes();
    sync();
  }
  // show slide n, with its k-th detail open (none for -1)
  function show(n, built = false, k = -1) {
    built ||= editing;  // the edit view shows every slide with all its builds
    if (ed) {  // commit what is being typed before the slide and the notes pane change
      settle();
      select(null);
    }
    clearTimeout(autoTimer);
    i = clamp(n, 0, slides.length - 1);
    det = k;
    slides.forEach((s, x) => s.classList.toggle('current', x === i));
    drawDetails();
    builds(slides[i]).forEach(b => b.classList.toggle('on', built));
    if (mode === 'deck') store.set(i);
    drawNotes();
    if (mode === 'deck' && !built && slides[i].dataset.auto !== undefined) autoBuild(+slides[i].dataset.auto || 500);
    if (editing) drawEdit();
    sync();
  }
  function autoBuild(delay) {
    const step = () => {
      const b = builds(slides[i]).find(x => !x.classList.contains('on'));
      if (!b) return;
      b.classList.add('on');
      sync();
      autoTimer = setTimeout(step, delay);
    };
    autoTimer = setTimeout(step, delay);
  }
  // slide n, or the first one from there on, going d, that is not skipped; the edit view passes over none.
  // Where the deck ends first, it stays on the current slide. So the show never comes to a skipped slide, and only
  // shows one when it starts there from the edit view: a backup slide, for the question it answers
  function seek(n, d) {
    while (!editing && skips(slides[n])) n += d;
    return slides[n] ? n : i;
  }
  // where a deck opens when the current slide is skipped: on the next one shown, or else the one before
  const land = () => seek(seek(i, 1), -1);
  // with a detail open, → closes it and goes on, ← only closes it
  function next() {
    clearTimeout(autoTimer);
    if (det >= 0) {
      det = -1;
      drawDetails();
      drawNotes();
    }
    const b = builds(slides[i]).find(x => !x.classList.contains('on'));
    b ? b.classList.add('on') : show(seek(i + 1, 1));
    sync();
  }
  function prev() {
    clearTimeout(autoTimer);
    if (det >= 0) return setDetail(-1);
    const on = builds(slides[i]).filter(x => x.classList.contains('on'));
    on.length ? on.pop().classList.remove('on') : show(seek(i - 1, -1), true);
    sync();
  }
  // show slide n with its first k builds on, or all of them when k < 0, and its d-th detail open (presenter and view windows)
  function apply(n, k, d = -1) {
    show(n, k < 0, d);
    builds(slides[i]).slice(0, Math.max(k, 0)).forEach(b => b.classList.add('on'));
  }
  // deck: tell an open presenter window where we are, slide i with k builds on and detail d open
  function sync() {
    if (mode !== 'deck' || !presenterWin || presenterWin.closed) return;
    const k = builds(slides[i]).filter(b => b.classList.contains('on')).length;
    presenterWin.postMessage({ deck: 'state', i, k, d: det, lang: cur }, '*');
  }
  // presenter: mirror the deck's state into the current and next panes, notes and labels
  function render(n, k, d = -1) {
    if (pv.last && (pv.last[0] !== n || pv.last[1] !== k || pv.last[2] !== d)) startTimer();  // the talk starts when the deck first moves
    pv.last = [n, k, d];
    apply(n, k, d);
    const left = builds(slides[i]).length - k;
    // the next press shows another build of this slide, unless it builds by itself;
    // otherwise the next slide as it first appears (data-auto slides fully built, since that is where they end up)
    const nextBuild = left > 0 && slides[i].dataset.auto === undefined;
    const after = seek(i + 1, 1), all = shown();
    pv.cur.contentWindow.postMessage({ deck: 'view', i, k, d, lang: cur }, '*');
    pv.next.contentWindow.postMessage(nextBuild ? { deck: 'view', i, k: k + 1, lang: cur }
      : { deck: 'view', i: after, k: slides[after].dataset.auto !== undefined ? -1 : 0, lang: cur }, '*');
    pv.label.textContent = nextBuild ? 'Next build' : 'Next slide';
    pv.end.hidden = nextBuild || after !== i;
    pv.count.textContent = skips(slides[i]) ? 'Skipped slide' : `Slide ${all.indexOf(slides[i]) + 1} of ${all.length}`;
    pv.left.textContent = d >= 0 ? 'A detail is open: → closes it and goes on' : left > 0 ? `${left} build${left > 1 ? 's' : ''} left on this slide` : '';
  }

  let t0 = null;
  let paused = null;  // when the timer was paused, or null while it runs
  const pad = n => String(n).padStart(2, '0');
  // icon paths, on a 16 px grid
  const ICONS = {
    play: 'M5 3.2v9.6L12.8 8z', pause: 'M5.5 3.5v9M10.5 3.5v9', reset: 'M3 8a5 5 0 1 0 1.5-3.5L3 6V2.5M3 6h3.5',
    back: 'M10 3 5 8l5 5', forward: 'm6 3 5 5-5 5', up: 'M8 13V3M3.5 7.5 8 3l4.5 4.5', close: 'M4 4l8 8M12 4l-8 8',
    display: 'M2.5 3h11a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 11.5V14M5.5 14h5',
    copy: 'M6 5.5h6.5a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1zM11 5.5V3a1 1 0 0 0-1-1H3.5a1 1 0 0 0-1 1v6.5a1 1 0 0 0 1 1H5',
    notes: 'M3.5 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM5.5 5.5h5M5.5 8h5M5.5 10.5h3',
    paneLeft: 'M2.5 3h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM6 3v10',
    paneRight: 'M2.5 3h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM10 3v10',
    trash: 'M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4', pencil: 'M10.5 3 13 5.5 5.5 13H3v-2.5zM9 4.5 11.5 7',
    help: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM6.2 6.2a1.9 1.9 0 1 1 2.8 1.7c-.6.3-1 .8-1 1.4M8 11.6v.1',
    bubble: 'M3 2.5h10A1.5 1.5 0 0 1 14.5 4v6a1.5 1.5 0 0 1-1.5 1.5H8L4.5 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5z',
    save: 'M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11', down: 'M8 3v10M3.5 8.5 8 13l4.5-4.5', check: 'M3 8.5 6.5 12 13 4.5',
    plus: 'M8 3v10M3 8h10', lang: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM1.5 8h13M8 1.5c-1.9 1.8-2.8 4-2.8 6.5s.9 4.7 2.8 6.5c1.9-1.8 2.8-4 2.8-6.5S9.9 3.3 8 1.5z', detail: 'M2.5 3h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8.5 3v10M10.5 6h2M10.5 8.5h2', saveAs: 'M6.5 3v7M3.5 7l3 3 3-3M2.5 13.5h11M12.5 2v4M10.5 4h4', chevron: 'M4.5 6.5 8 10l3.5-3.5', skip: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3 2.5l10 11'
  };
  const icon = (name, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
  // an icon-only button, and one with its label beside the icon
  const tool = (cls, label, name, size) => `<button type="button" class="${cls}" aria-label="${label}" title="${label}">${icon(name, size)}</button>`;
  const labelled = (cls, label, name, title) => `<button type="button" class="${cls}"${title ? ` title="${title}"` : ''}>${icon(name)}<span>${label}</span></button>`;
  function tick() {
    if (t0 === null) return;
    const s = Math.floor(((paused ?? Date.now()) - t0) / 1000);
    timer.textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    pv?.pause.setAttribute('d', ICONS[paused === null ? 'pause' : 'play']);
  }
  setInterval(tick, 500);
  function startTimer() { if (t0 === null) t0 = Date.now(); tick(); }
  function resetTimer() { t0 = Date.now(); paused &&= t0; tick(); }
  // pause or resume; a timer not running yet starts
  function pauseTimer() {
    if (t0 === null) return startTimer();
    if (paused === null) paused = Date.now();
    else { t0 += Date.now() - paused; paused = null; }
    tick();
  }

  const NAV = ['ArrowRight', ' ', 'PageDown', 'ArrowLeft', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'l', 'L'];
  function act(key) {
    // the presenter window steers the deck window, which answers with its new state
    if (mode === 'presenter' && NAV.includes(key)) {
      opener?.postMessage({ deck: 'key', key }, '*');
      return true;
    }
    switch (key) {
      case 'ArrowRight': case ' ': case 'PageDown': next(); break;
      case 'ArrowLeft': case 'PageUp': editing ? show(i - 1, true) : prev(); break;
      case 'ArrowDown': show(seek(i + 1, 1), true); break;
      case 'ArrowUp': show(seek(i - 1, -1), true); break;
      case 'Home': show(seek(0, 1)); break;
      case 'End': show(seek(slides.length - 1, -1), true); break;
      case 'n': case 'N':
        if (!editing) return false;
        notes.hidden = !notes.hidden;
        fit();
        break;
      case 'f': case 'F':
        document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        break;
      case 'p': case 'P': print(); break;
      case 'l': case 'L':
        if (langs.length < 2) return false;
        setLang(nextLang());
        break;
      case 's': case 'S':
        if (mode === 'deck') presenterWin = open(here + '?presenter', 'deck-presenter', 'popup,width=1280,height=800');
        break;
      case 'e': case 'E': if (canEdit) edit(!editing); break;
      case 'Escape':
        if (!editing) {
          if (det < 0) return false;
          setDetail(-1);
          break;
        }
        if (!ed.menu.hidden) showLayouts(false);
        else if (!ed.copyBox.hidden) showBox();
        else if (ed.sel) select(null);
        else if (det >= 0) setDetail(-1);
        else edit(false);
        break;
      case 'Delete': case 'Backspace':
        if (!editing || !ed.sel) return false;
        alter('Deleted', { kind: 'delete' });
        break;
      default: return false;
    }
    return true;
  }
  addEventListener('keydown', e => {
    const typing = e.target.closest('textarea, input, select') || e.target.isContentEditable;
    // edit view shortcuts; while text is being typed, Cmd/Ctrl+Z and the arrows are left to the browser
    if (editing && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      const key = e.key.toLowerCase();
      if (key === 's') { e.preventDefault(); saveDeck(); }
      if (key === 'z' && !typing) { e.preventDefault(); undoChange(); }
      if ((key === 'arrowup' || key === 'arrowdown') && !typing && !suggesting) { e.preventDefault(); stepSlide(key === 'arrowup' ? -1 : 1); }
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // typing a suggestion or the notes: keys are text, Esc only leaves the text box
    if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
    if (act(e.key)) e.preventDefault();
  });

  // file:// pages all have origin "null", so messages go to '*' and are checked by who sent them
  addEventListener('message', e => {
    const m = e.data || {};
    if (mode === 'deck' && (m.deck === 'hello' || m.deck === 'key') && (e.source === presenterWin || e.source?.opener === window)) {
      presenterWin = e.source;
      m.deck === 'key' && NAV.includes(m.key) ? act(m.key) : sync();
    } else if (mode === 'presenter' && m.deck === 'state' && e.source === opener) {
      pv.seen = Date.now();
      pv.link.hidden = true;
      // the heartbeat repeats the state every 2 s; only redraw when it changed
      const langWas = cur;
      if (m.lang && langs.includes(m.lang) && m.lang !== cur) {
        cur = m.lang;
        drawLang();
      }
      if (!pv.last || pv.last[0] !== m.i || pv.last[1] !== m.k || pv.last[2] !== (m.d ?? -1) || langWas !== cur) render(m.i, m.k, m.d ?? -1);
    } else if (mode === 'view' && m.deck === 'view' && e.source === parent) {
      // the edit view sends a thumbnail the current HTML of its slide; only accepted from this deck's own origin
      if (m.html !== undefined && e.origin === self.origin) {
        const t = document.createElement('template');
        t.innerHTML = m.html;
        const slide = t.content.firstChild;
        slides[m.i].replaceWith(slide);
        slides[m.i] = slide;
      }
      if (m.lang && langs.includes(m.lang)) cur = m.lang;
      drawLang();
      apply(m.i, m.k, m.d ?? -1);
    }
  });

  // click or tap: the left 30 % of the viewport goes back, the rest forward; links, buttons and other controls keep working.
  // An element with data-detail opens its detail; while one is open, a click outside it or on its close button closes it.
  // In edit mode a click selects or marks instead
  const stage = document.getElementById('stage');
  let swiped = false, tx = 0, ty = 0;
  stage.addEventListener('click', e => {
    if (swiped || editing) return;
    const chooser = e.target.closest('[data-set-lang]');
    if (chooser) return setLang(chooser.dataset.setLang);
    const opener = e.target.closest('[data-detail]'), k = opener ? details(slides[i]).findIndex(x => x.id === opener.dataset.detail && !skips(x)) : -1;
    if (k >= 0) return setDetail(k);
    if (det >= 0) {
      if (e.target.closest('.detail-close') || !e.target.closest('.detail')) setDetail(-1);
      return;
    }
    if (e.target.closest('a, button, input, select, textarea, label, summary, video, audio')) return;
    (e.clientX < innerWidth * 0.3 ? prev : next)();
  });
  // swipe on touch: left is forward, right is back; a swipe suppresses the click that follows it
  addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (editing || Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    swiped = true; setTimeout(() => { swiped = false; }, 300);
    act(dx < 0 ? 'ArrowRight' : 'ArrowLeft');
  }, { passive: true });

  // slide view: buttons for back, the presenter view, the edit view, the shortcuts and forward, shown while the pointer
  // is near the bottom-left corner. They never take focus, so Space and the arrows keep steering the deck
  if (mode === 'deck') {
    const box = document.createElement('div');
    box.id = 'deck-controls';
    const button = (cls, label, title, name) =>
      `<button type="button" class="${cls}" tabindex="-1" aria-label="${label}" title="${title}">${icon(name)}</button>`;
    const KEYS = [['→ Space PgDn', 'Next'], ['← PgUp', 'Previous'], ['↓ ↑', 'Whole slide forward / back'], ['Home End', 'First / last slide'],
      ['F', 'Fullscreen'], ['P', 'Print to PDF'],
      ['S', 'Presenter view'], ...canEdit ? [['E', 'Edit view']] : [], ...langs.length > 1 ? [['L', 'Language']] : [], ['Esc', 'Close']];
    box.innerHTML = '<div id="deck-help" hidden>' + KEYS.map(([keys, what]) =>
      `<div class="c-keys">${keys.split(' ').map(k => `<span>${k}</span>`).join('')}</div><div>${what}</div>`).join('') + '</div>' +
      button('c-back', 'Back', 'Back (←)', 'back') + button('c-present', 'Presenter view', 'Presenter view (S)', 'display') +
      (canEdit ? button('c-edit', 'Edit view', 'Edit view (E)', 'pencil') : '') +
      (langs.length > 1 ? button('c-lang', 'Language', 'Language (L)', 'lang') : '') + button('c-help', 'Keyboard shortcuts', 'Keyboard shortcuts', 'help') +
      button('c-fwd', 'Forward', 'Forward (→)', 'forward');
    const help = box.firstChild, helpButton = box.querySelector('.c-help');
    // the shortcuts stay up, with the buttons, until dismissed
    const showHelp = on => {
      help.hidden = !on;
      box.classList.toggle('open', on);
      helpButton.setAttribute('aria-expanded', on);
    };
    showHelp(false);
    box.addEventListener('mousedown', e => e.preventDefault());
    helpButton.addEventListener('click', () => showHelp(help.hidden));
    box.querySelector('.c-back').addEventListener('click', () => act('ArrowLeft'));
    box.querySelector('.c-edit')?.addEventListener('click', () => { showHelp(false); act('e'); });
    box.querySelector('.c-fwd').addEventListener('click', () => act('ArrowRight'));
    box.querySelector('.c-present').addEventListener('click', () => { showHelp(false); act('s'); });
    box.querySelector('.c-lang')?.addEventListener('click', () => act('l'));
    // a click elsewhere only dismisses them: seen first, so the slide does not advance as well
    addEventListener('click', e => {
      if (help.hidden || box.contains(e.target)) return;
      showHelp(false);
      e.stopPropagation();
    }, true);
    addEventListener('keydown', e => { if (['Escape', 'e', 'E'].includes(e.key)) showHelp(false); });
    document.body.append(box);
    addEventListener('pointermove', e => box.classList.toggle('near', e.clientX < 320 && e.clientY > innerHeight - 140));
    document.documentElement.addEventListener('mouseleave', () => box.classList.remove('near'));
  }

  // fit the slide to the window, or in the edit view to the room between its panes
  function fit() {
    const root = document.documentElement.style;
    // a ?view pane is always 16:9, so it fills its frame: no sub-pixel bar of the page behind the slide
    if (!editing) return root.setProperty('--scale', Math[mode === 'view' ? 'max' : 'min'](innerWidth / 1920, innerHeight / 1080));
    const rail = railOn ? RAIL_W : 0, pane = paneOn ? PANE_W : 0;
    const w = innerWidth - rail - pane - 2 * GAP, h = innerHeight - BAR_H - STATUS_H - (notes.hidden ? 0 : NOTES_H) - 2 * GAP;
    root.setProperty('--scale', Math.max(.05, Math.min(w / 1920, h / 1080)));
    root.setProperty('--edit-rail', rail + 'px');
    root.setProperty('--edit-pane', pane + 'px');
    root.setProperty('--edit-x', rail + GAP + w / 2 + 'px');
    root.setProperty('--edit-y', BAR_H + GAP + h / 2 + 'px');
  }
  addEventListener('resize', fit);
  fit();
  // a refresh in the edit view is about to return to it, on the same slide
  show(store.get(EDIT_KEY) ? i : land());
  // keep the screen awake while the deck shows; the browser drops the lock when the tab is hidden, and may refuse it
  const awake = () => { if (document.visibilityState === 'visible') navigator.wakeLock?.request('screen').catch(() => {}); };
  if (mode !== 'view') { awake(); document.addEventListener('visibilitychange', awake); }
  // Print: each detail gets a page after its slide, a copy of the slide with that detail open. The copies are only in the
  // document while it prints
  let printed = [];
  function printDetails(on) {
    printed.forEach(c => c.remove());
    printed = [];
    if (on) slides.forEach(s => details(s).reduce((after, x, k) => {
      if (skips(x)) return after;
      const c = s.cloneNode(true);
      c.classList.remove('current');
      c.classList.add('detail-page');
      details(c).forEach((y, j) => y.classList.toggle('open', j === k));
      after.after(c);
      printed.push(c);
      return c;
    }, s));
  }
  addEventListener('beforeprint', () => printDetails(true));
  addEventListener('afterprint', () => printDetails(false));
  matchMedia('print').addEventListener('change', e => printDetails(e.matches));
  // ?print: print once images and fonts are in
  if (params.has('print')) addEventListener('load', () => document.fonts.ready.then(() => print()));

  // presenter window: current slide, next slide, notes and timer; both slides are this file opened as ?view
  if (mode === 'presenter') {
    const css = document.createElement('style');
    css.textContent = `
      @media screen{
        html.presenter,html.presenter body{background:#111110}
        html.presenter #stage{display:none}
        /* timer on top, current slide left, next slide above the notes right */
        #presenter{position:fixed;inset:0;box-sizing:border-box;padding:12px 20px 16px;display:grid;row-gap:12px;
          grid-template:"top top top" auto "cur vbar side" minmax(0,1fr) / minmax(0,var(--cur-w,62%)) 20px minmax(0,1fr);
          color:#F2F2EF;font:400 15px/1.4 system-ui,sans-serif;-webkit-font-smoothing:antialiased}
        #presenter [hidden]{display:none!important}
        .p-top{grid-area:top;display:flex;align-items:center;gap:8px}
        html.presenter #timer{position:static;padding:0 8px 0 0;background:none;border:0;color:#F2F2EF;
          font:500 26px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums}
        .p-link{padding:5px 10px;border-radius:3px;background:rgba(255,69,58,.18);color:#FF6961;font-size:13px;font-weight:500}
        .p-clock{margin-left:auto;color:#8F8F8A;font:500 16px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums}
        #presenter button{display:grid;place-items:center;padding:0;border:0;background:rgba(255,255,255,.1);color:#F2F2EF;cursor:pointer}
        #presenter button:hover{background:rgba(255,255,255,.18)}
        .p-pause,.p-reset{width:30px;height:30px;border-radius:3px}
        .p-pause svg{fill:currentColor}
        .p-vbar{grid-area:vbar;cursor:col-resize}
        .p-hbar{flex:none;height:20px;cursor:row-resize}
        .p-vbar,.p-hbar{position:relative;touch-action:none}
        /* a hairline that thickens under the pointer */
        .p-vbar::after,.p-hbar::after{content:"";position:absolute;border-radius:2px;background:rgba(255,255,255,.12)}
        .p-vbar::after{top:0;bottom:0;left:9.5px;width:1px}
        .p-hbar::after{left:0;right:0;top:9.5px;height:1px}
        .p-vbar:hover::after,.p-vbar.p-drag::after{left:8px;width:4px;background:rgba(255,255,255,.35)}
        .p-hbar:hover::after,.p-hbar.p-drag::after{top:8px;height:4px;background:rgba(255,255,255,.35)}
        /* a slide pane holds the largest 16:9 slide that fits */
        .p-slide,.p-next{container-type:size;display:grid;place-items:center}
        #presenter iframe{display:block;width:min(100cqw,calc(100cqh * 16 / 9));aspect-ratio:16/9;border:0;border-radius:3px;background:#000;pointer-events:none}
        .p-cur{grid-area:cur;display:flex;flex-direction:column;gap:12px;min-height:0}
        .p-slide{flex:1;min-height:0}
        .p-nav{flex:none;display:flex;align-items:center;justify-content:center;gap:16px}
        /* previous, the count and next in one outlined bar */
        .p-ctl{display:flex;align-items:center;gap:8px;padding:3px;border-radius:4px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}
        #presenter .p-ctl button{width:34px;height:34px;border-radius:2px;background:none}
        #presenter .p-ctl button:hover{background:rgba(255,255,255,.12)}
        .p-count{font:500 12px/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;font-variant-numeric:tabular-nums}
        .p-left{color:#8F8F8A;font-size:13px}
        .p-side{grid-area:side;display:flex;flex-direction:column;min-width:0;min-height:0}
        .p-label{flex:none;margin-bottom:8px;font:500 11px/1.4 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8F8F8A}
        .p-next{position:relative;flex:none;width:100%;aspect-ratio:16/9}
        #presenter.sized .p-next{flex:0 1 var(--next-h);min-height:80px;aspect-ratio:auto}
        .p-end{position:absolute;inset:0;display:grid;place-items:center;border-radius:3px;background:#000;color:#8F8F8A}
        .p-notes{flex:1;position:relative;min-height:80px}
        html.presenter #notes{position:absolute;inset:0;max-height:none;overflow:auto;padding:16px 20px;border:0;border-radius:3px;
          background:#1C1C1A;color:#F2F2EF;font:400 24px/1.5 system-ui,sans-serif}
        html.presenter #notes::before{margin-bottom:12px;font:500 11px/1.4 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8F8F8A}
        .p-size{position:absolute;top:10px;right:12px;z-index:11;display:flex;gap:4px}
        #presenter .p-size button{padding:5px 8px;border-radius:3px;font:500 12px/1 system-ui,sans-serif}
      }
      @media print{#presenter{display:none}}`;
    document.head.append(css);
    document.documentElement.classList.add('presenter');
    document.title = 'Presenter: ' + document.title;
    const ui = document.createElement('div');
    ui.id = 'presenter';
    ui.innerHTML =
      '<div class="p-top">' + tool('p-pause', 'Pause or resume the timer', 'play') + tool('p-reset', 'Reset the timer', 'reset') +
      '<div class="p-link" hidden>Not linked: press S in the deck window</div><span class="p-clock"></span></div>' +
      '<div class="p-cur"><div class="p-slide"><iframe tabindex="-1" title="Current slide"></iframe></div>' +
      '<div class="p-nav"><div class="p-ctl">' + tool('p-back', 'Previous', 'back', 18) +
      '<div class="p-count"></div>' + tool('p-fwd', 'Next', 'forward', 18) + '</div>' +
      '<div class="p-left"></div></div></div>' +
      '<div class="p-vbar" title="Drag to resize, double-click to reset"></div>' +
      '<div class="p-side"><div class="p-label">Next slide</div>' +
      '<div class="p-next"><iframe tabindex="-1" title="Next slide or build"></iframe><div class="p-end" hidden>End of deck</div></div>' +
      '<div class="p-hbar" title="Drag to resize, double-click to reset"></div>' +
      '<div class="p-notes"><div class="p-size">' +
      '<button type="button" aria-label="Smaller notes">A−</button><button type="button" aria-label="Larger notes">A+</button></div></div></div>';
    const $ = s => ui.querySelector(s);
    pv = { cur: $('.p-cur iframe'), next: $('.p-next iframe'), label: $('.p-label'), end: $('.p-end'), count: $('.p-count'),
      left: $('.p-left'), clock: $('.p-clock'), link: $('.p-link'), pause: $('.p-pause path'), last: null, seen: 0 };
    // a pane that finishes loading after the last update gets that update again
    [pv.cur, pv.next].forEach(f => {
      f.addEventListener('load', () => pv.last && render(...pv.last));
      f.src = here + '?view';
    });
    $('.p-top').prepend(timer);
    $('.p-notes').prepend(notes);
    notes.hidden = false;

    // the buttons never take focus, so Space and the arrows keep steering the deck
    ui.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    $('.p-back').addEventListener('click', () => act('ArrowLeft'));
    $('.p-fwd').addEventListener('click', () => act('ArrowRight'));
    $('.p-pause').addEventListener('click', pauseTimer);
    $('.p-reset').addEventListener('click', resetTimer);

    // notes size, remembered in this browser
    const SIZES = [16, 18, 20, 24, 28, 32, 40], SIZE_KEY = 'deck:presenter-notes-size';
    let size = SIZES.indexOf(local.get(SIZE_KEY));
    if (size < 0) size = SIZES.indexOf(24);
    const resize = d => {
      size = clamp(size + d, 0, SIZES.length - 1);
      notes.style.fontSize = SIZES[size] + 'px';
      local.set(SIZE_KEY, SIZES[size]);
    };
    ui.querySelectorAll('.p-size button').forEach((b, n) => b.addEventListener('click', () => resize(n ? 1 : -1)));
    resize(0);

    // drag the bars between the panes to resize them, double-click a bar to reset it; remembered like the notes size
    const LAYOUT_KEY = 'deck:presenter-layout', SPLIT = 62, was = local.get(LAYOUT_KEY) || {};
    // current slide: % of the width; next slide: vh, 0 = as tall as 16:9 needs
    const layout = { w: clamp(+was.w || SPLIT, 25, 80), h: +was.h ? clamp(+was.h, 15, 75) : 0 };
    const relayout = () => {
      ui.style.setProperty('--cur-w', layout.w + '%');
      ui.style.setProperty('--next-h', layout.h + 'vh');
      ui.classList.toggle('sized', layout.h > 0);
      local.set(LAYOUT_KEY, layout);
    };
    const bar = (el, move, reset) => {
      el.addEventListener('pointerdown', e => {
        e.preventDefault();  // no focus, no text selection: the keys keep steering the deck
        el.setPointerCapture(e.pointerId);
        el.classList.add('p-drag');
        const onMove = ev => { move(ev); relayout(); };
        const done = () => {
          el.classList.remove('p-drag');
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerup', done);
          el.removeEventListener('pointercancel', done);
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', done);
        el.addEventListener('pointercancel', done);
      });
      el.addEventListener('dblclick', () => { reset(); relayout(); });
    };
    // the pointer stays on the middle of the 20 px bar, past the 20 px padding
    bar($('.p-vbar'), ev => { layout.w = clamp((ev.clientX - 30) / (ui.clientWidth - 40) * 100, 25, 80); }, () => { layout.w = SPLIT; });
    bar($('.p-hbar'), ev => { layout.h = clamp((ev.clientY - 10 - pv.next.parentElement.getBoundingClientRect().top) / innerHeight * 100, 15, 75); }, () => { layout.h = 0; });
    relayout();
    document.body.append(ui);

    // heartbeat: the deck answers every hello with its state, which also re-links after the deck window reloads
    const hello = () => opener?.postMessage({ deck: 'hello' }, '*');
    setInterval(hello, 2000);
    hello();
    // clock, and the badge when there is no deck window or nothing came from it for 5 s
    const status = () => {
      pv.clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      pv.link.hidden = !!opener && !opener.closed && Date.now() - pv.seen < 5000;
    };
    setInterval(status, 1000);
    status();
  }

  // ---- the edit view: a public copy leaves out everything from here to the line that ends it, so nothing above may need it there ----
  // edit view (E, deck window only): thumbnails left, the slide with its notes below, unsaved edits or suggestions right
  function edit(on) {
    if (!ed) buildEdit();
    if (!on) {
      settle();
      select(null);
      showLayouts(false);
      showBox();
    }
    editing = on;
    store.set(on ? '1' : '', EDIT_KEY);
    document.documentElement.classList.toggle('editing', on);
    notes.hidden = !on;
    notes.contentEditable = on && !suggesting;
    fit();
    if (on) show(i, true, det);
    else {
      closeAsk();
      // the show does not open a skipped detail: one open here closes
      drawDetails();
      drawNotes();
    }
  }
  function editCss() {
    return `
      @media screen{
        #edit,#edit-bar,#edit-rail,#edit-status,#edit-layer,#edit-layouts,#edit-copy{display:none}
        html.editing,html.editing body{background:#EFEFEC}
        html.editing #stage{left:var(--edit-x);top:var(--edit-y);box-shadow:0 0 0 calc(1px / var(--scale)) rgba(0,0,0,.16)}
        /* nothing moves here: outlines are measured from what is on the slide */
        html.editing :is(.build,.detail){transition:none}
        /* a text shown in another language, for want of one in the language shown */
        html.editing #stage [data-lang-missing]{opacity:.45;outline:calc(1.5px / var(--scale)) dashed #FF9500;outline-offset:calc(3px / var(--scale))}
        .e-missing{margin-left:12px;color:#C93400}
        #edit-bar .e-lang{margin-left:4px;font-variant-numeric:tabular-nums}
        html.editing .slide,html.editing .slide *{animation:none!important}
        html.editing #edit-layer{display:block;position:absolute;inset:0;z-index:2147483647;cursor:default;touch-action:none}
        /* marks sit in the scaled slide; dividing by --scale keeps their lines and numbers one size on screen.
           A thin dark edge keeps the orange visible on any slide */
        .e-mark{position:absolute;pointer-events:none}
        .e-mark span{position:absolute;left:0;bottom:100%;width:28px;height:22px;display:grid;place-items:center;
          border-radius:2px 2px 2px 0;background:#007AFF;color:#fff;
          font:600 11px/1 system-ui,sans-serif;box-shadow:0 0 0 1px rgba(0,0,0,.25);transform:scale(calc(1 / var(--scale)));
          transform-origin:0 100%;pointer-events:auto;cursor:pointer}
        .e-box,.e-hover,.e-sel{box-sizing:border-box;border:calc(2px / var(--scale)) solid #FF9500;border-radius:calc(2px / var(--scale));
          box-shadow:0 0 0 calc(1px / var(--scale)) rgba(0,0,0,.25)}
        .e-sel{border-color:#007AFF}
        /* the text being typed in */
        html.editing .slide [contenteditable]{outline:calc(2px / var(--scale)) solid #007AFF;outline-offset:calc(2px / var(--scale));cursor:text}
        #edit-layer>.e-box{border-style:dashed}
        .e-mark.e-lit{box-shadow:0 0 0 calc(4px / var(--scale)) rgba(0,122,255,.45)}
        .e-mark.e-lit span{transform:scale(calc(1.2 / var(--scale)))}
        /* its element is gone or changed */
        .e-box.e-stale{border-style:dashed;border-color:#8E8E93}
        .e-mark.e-stale span{background:#8E8E93}
        /* the panes use the system font, whatever the deck's fonts are */
        html.editing #edit-bar,html.editing #edit-rail,html.editing #edit,html.editing #edit-status{position:fixed;z-index:20;box-sizing:border-box;
          color:#111110;font:400 13px/1.4 system-ui,sans-serif;-webkit-font-smoothing:antialiased}
        html.editing #edit-bar{top:0;left:0;right:0;height:${BAR_H}px;display:flex;align-items:center;gap:4px;padding:0 12px 0 16px;
          background:#fff;border-bottom:1px solid rgba(0,0,0,.14)}
        .e-name{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600}
        #edit-bar button,.e-foot button,#edit-status button{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;min-width:30px;
          padding:0 7px;border:0;border-radius:3px;background:none;color:#111110;font:500 13px/1 system-ui,sans-serif;cursor:pointer}
        #edit-bar button:hover,.e-foot button:hover,#edit-status button:hover{background:rgba(0,0,0,.06)}
        .e-show svg{fill:currentColor}
        /* what New slide can add, under its button */
        html.editing #edit-layouts{position:fixed;z-index:30;display:grid;grid-template-columns:repeat(2,160px);gap:4px;box-sizing:border-box;padding:6px;border-radius:4px;
          background:#fff;color:#111110;
          box-shadow:0 0 0 1px rgba(0,0,0,.16),0 8px 24px rgba(0,0,0,.12);font:500 13px/1 system-ui,sans-serif;-webkit-font-smoothing:antialiased}
        #edit-layouts button{display:flex;flex-direction:column;gap:6px;padding:6px;border:0;border-radius:3px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
        #edit-layouts button:hover{background:rgba(0,0,0,.06)}
        /* what Save can write, under its button: the deck, or a public copy and what that leaves out */
        html.editing #edit-copy{position:fixed;z-index:30;display:flex;flex-direction:column;gap:2px;width:320px;box-sizing:border-box;padding:6px;border-radius:4px;
          background:#fff;color:#111110;box-shadow:0 0 0 1px rgba(0,0,0,.16),0 8px 24px rgba(0,0,0,.12);font:400 13px/1.45 system-ui,sans-serif;-webkit-font-smoothing:antialiased}
        #edit-copy button{display:grid;grid-template-columns:16px 1fr;gap:10px;align-items:start;padding:8px 10px;border:0;border-radius:3px;background:none;color:inherit;
          font:inherit;text-align:left;cursor:pointer}
        #edit-copy button:hover{background:rgba(0,0,0,.06)}
        #edit-copy svg{margin-top:1px}
        #edit-copy b{display:block;font-weight:500}
        #edit-copy small{display:block;margin-top:2px;color:#6B6B66;font-size:12px}
        #edit-bar .e-save svg:last-child{margin-left:-2px;color:#6B6B66}
        #edit-copy small b{display:inline;color:#111110}
        .e-tools,.e-ask-tools,.e-slide-tools{display:flex;align-items:center;gap:2px;margin-right:8px;padding-right:8px;border-right:1px solid rgba(0,0,0,.1)}
        .e-tools-label{margin:0 6px;color:#6B6B66;font:500 11px/1 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase}
        .e-mode{display:flex;gap:2px;margin:0 8px;padding:2px;border-radius:4px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.16)}
        #edit-bar .e-mode button{height:26px}
        #edit-bar button[aria-expanded=true]{background:rgba(0,0,0,.06)}
        #edit-bar button[aria-pressed=true]{background:#111110;color:#fff}
        #edit-bar button:disabled,.e-foot button:disabled{opacity:.4;pointer-events:none}
        html.editing #edit-rail{display:block;top:${BAR_H}px;left:0;bottom:${STATUS_H}px;width:${RAIL_W}px;overflow:auto;padding:12px 14px 12px 6px;
          background:#FAFAF8;border-right:1px solid rgba(0,0,0,.1)}
        .e-thumb{position:relative;display:grid;grid-template-columns:22px 1fr;align-items:start;margin-bottom:12px;cursor:pointer}
        .e-thumb-count{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;box-sizing:border-box;padding:0 5px;border-radius:2px;background:#111110;
          color:#fff;font:600 11px/18px system-ui,sans-serif;text-align:center;font-variant-numeric:tabular-nums}
        .e-thumb-n{padding:2px 7px 0 0;color:#6B6B66;font:400 10px/1.4 system-ui,sans-serif;font-variant-numeric:tabular-nums;text-align:right}
        .e-thumb-frame{display:block;aspect-ratio:16/9;overflow:hidden;border-radius:2px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.14)}
        .e-thumb:hover .e-thumb-frame{box-shadow:0 0 0 1px rgba(0,0,0,.4)}
        .e-thumb.e-cur .e-thumb-frame{box-shadow:0 0 0 2px #111110}
        .e-thumb.e-cur .e-thumb-n{color:#111110;font-weight:600}
        .e-thumb.e-skip iframe{opacity:.35}
        .e-thumb-skip{display:none;position:absolute;inset:0 0 0 22px;place-items:center;color:#111110;pointer-events:none}
        .e-thumb.e-skip>.e-thumb-skip,.e-sub.e-skip>.e-thumb-skip{display:grid}
        .e-sub .e-thumb-skip{inset:0 15% 0 14px}
        .e-sub.e-skip iframe{opacity:.35}
        /* the icon is drawn larger here: the same 1.5 px line as in the toolbar */
        .e-thumb-skip svg{stroke-width:.86}
        /* a slide's details, as smaller thumbnails set in under it */
        .e-subs{grid-column:2;display:grid;gap:6px;margin-top:6px}
        .e-subs:empty{display:none}
        .e-sub{position:relative;padding-left:14px;border-left:2px solid rgba(0,0,0,.14)}
        .e-sub .e-thumb-del{right:calc(15% + 4px)}
        .e-sub:hover .e-thumb-del{opacity:1}
        .e-sub-frame{display:block;width:85%;aspect-ratio:16/9;overflow:hidden;border-radius:2px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.14)}
        .e-sub-frame iframe{display:block;width:100%;height:100%;border:0;pointer-events:none}
        .e-sub:hover .e-sub-frame{box-shadow:0 0 0 1px rgba(0,0,0,.4)}
        .e-sub.e-cur{border-left-color:#111110}
        .e-sub.e-cur .e-sub-frame{box-shadow:0 0 0 2px #111110}
        .e-thumb iframe,#edit-layouts iframe{display:block;width:100%;height:100%;border:0;pointer-events:none}
        .e-thumb-del{position:absolute;top:4px;right:4px;display:grid;place-items:center;width:20px;height:20px;padding:0;border:0;border-radius:2px;
          background:#fff;color:#111110;box-shadow:0 0 0 1px rgba(0,0,0,.2);cursor:pointer;opacity:0}
        /* the count of suggestions has the corner */
        .e-thumb-count:not([hidden])~.e-thumb-del{right:18px}
        .e-thumb:hover>.e-thumb-del{opacity:1}
        .e-thumb-del:hover{background:#111110;color:#fff}
        /* a deck keeps one slide at least; a detail can always go, except in Suggest */
        #edit-rail.e-suggest .e-thumb-del,#edit-rail.e-one .e-thumb>.e-thumb-del{display:none}
        /* where a dragged thumbnail will land: in the gap above this one, or below the last */
        .e-drop::before,.e-drop-end::after{content:"";position:absolute;left:22px;right:0;height:2px;background:#111110}
        .e-drop::before{top:-8px}
        .e-drop-end::after{bottom:-8px}
        html.editing #notes{position:fixed;z-index:10;left:var(--edit-rail);right:var(--edit-pane);bottom:${STATUS_H}px;height:${NOTES_H}px;max-height:none;box-sizing:border-box;
          padding:12px 20px;background:#fff;color:#111110;border-top:1px solid rgba(0,0,0,.1);font:400 13px/1.5 system-ui,sans-serif;-webkit-font-smoothing:antialiased}
        html.editing #notes[contenteditable=true]{outline:none;cursor:text}
        html.editing #notes::before{margin-bottom:10px;font:500 11px/1.4 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#6B6B66}
        html.editing #edit-status{left:0;right:0;bottom:0;height:${STATUS_H}px;display:flex;align-items:center;justify-content:space-between;
          padding:0 6px 0 16px;background:#EFEFEC;border-top:1px solid rgba(0,0,0,.1);color:#6B6B66;font-size:12px}
        #edit-status button{height:24px;min-width:24px;padding:0 4px;color:#6B6B66}
        #edit-status button[aria-pressed=false]{color:#AEAEB2}
        .e-status-buttons{display:flex;gap:2px}
        /* in the gap between the toolbar and the slide */
        .e-skipped{position:fixed;top:${BAR_H + 2}px;left:var(--edit-x);transform:translateX(-50%);display:flex;align-items:center;gap:6px;height:20px;
          padding:0 8px;border-radius:2px;background:#111110;color:#fff;font:500 11px/1 system-ui,sans-serif;white-space:nowrap;pointer-events:none}
        .e-skipped[hidden]{display:none}
        html.editing #edit{top:${BAR_H}px;right:0;bottom:${STATUS_H}px;width:${PANE_W}px;display:flex;flex-direction:column;
          background:#FAFAF8;border-left:1px solid rgba(0,0,0,.1)}
        .e-pane{flex:1;min-height:0;display:flex;flex-direction:column}
        .e-head{flex:none;display:flex;align-items:center;gap:8px;padding:14px 16px 12px;border-bottom:1px solid rgba(0,0,0,.1);font:500 11px/1.4 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase}
        .e-head svg{color:#6B6B66}
        .e-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:32px 28px;color:#6B6B66;text-align:center}
        .e-list{flex:1;min-height:0;overflow:auto;padding-bottom:8px}
        /* one label per slide, then its suggestions as rows: click one to edit it, remove on hover */
        .e-go,.e-slide{display:block;width:100%;box-sizing:border-box;margin-top:8px;padding:10px 16px 4px;border:0;border-top:1px solid rgba(0,0,0,.08);
          background:none;color:#6B6B66;font:600 12px/1.4 system-ui,sans-serif;text-align:left;white-space:nowrap;overflow:hidden;
          text-overflow:ellipsis;cursor:pointer}
        .e-go:first-child,.e-slide:first-child{margin-top:0;border-top:0}
        .e-go:hover,.e-go.e-cur,.e-slide:hover,.e-slide.e-cur{color:#111110}
        .e-change{position:relative;margin:0 8px;padding:8px 32px 8px 8px;border-radius:3px;cursor:pointer}
        .e-change:hover{background:rgba(0,0,0,.05)}
        .e-change-warn{color:#C93400;font-size:12px}
        .e-item{position:relative;display:grid;grid-template-columns:26px 1fr;margin:0 8px;padding:8px 32px 8px 8px;border-radius:3px;cursor:pointer}
        .e-item:hover,.e-item.e-lit{background:rgba(0,0,0,.05)}
        .e-n{grid-row:1/3;font:600 11px/1.7 system-ui,sans-serif;font-variant-numeric:tabular-nums;color:#AEAEB2}
        .e-cur .e-n{color:#007AFF}
        .e-note{white-space:pre-wrap;overflow-wrap:anywhere}
        .e-note:empty::before{content:"Describe the change";color:#6B6B66}
        .e-el{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6B6B66;font-size:12px}
        .e-del,.e-change-del{position:absolute;top:6px;right:6px;display:grid;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:2px;background:none;
          color:#6B6B66;cursor:pointer;opacity:0}
        .e-item:hover .e-del,.e-change:hover .e-change-del,.e-change-del.e-armed{opacity:1}
        .e-del:hover,.e-change-del:hover{background:rgba(0,0,0,.08);color:#111110}
        .e-changed{margin-right:6px;padding:1px 6px;border-radius:2px;background:rgba(0,0,0,.07);color:#3A3A3C;font-weight:500}
        .e-foot{flex:none;display:flex;padding:8px 10px;border-top:1px solid rgba(0,0,0,.1)}
        .e-foot .e-clear,.e-foot .e-clear-edits{margin-left:auto}
        .e-foot .e-copy{padding:0 12px;background:#111110;color:#fff}
        .e-foot .e-copy:hover{background:#3A3A37}
        /* the box that opens beside a selection: what it is about, the field, delete and save */
        #edit-ask{position:fixed;z-index:30;width:380px;box-sizing:border-box;padding:12px 14px 10px;border-radius:4px;background:#fff;color:#111110;
          box-shadow:0 0 0 1px rgba(0,0,0,.2),0 12px 32px rgba(0,0,0,.16);font:400 14px/1.45 system-ui,sans-serif;-webkit-font-smoothing:antialiased}
        .e-ask-path{overflow:hidden;white-space:pre;text-overflow:ellipsis;color:#6B6B66;font-size:12px}
        .e-crumb{padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer}
        .e-crumb:hover{color:#007AFF}
        .e-crumb.e-at{color:#111110;font-weight:600}
        #edit-ask textarea{display:block;width:100%;max-height:180px;box-sizing:border-box;margin:8px 0 6px;padding:2px 0;border:0;outline:none;
          background:none;color:#111110;font:inherit;resize:none}
        #edit-ask textarea::placeholder{color:#6B6B66}
        .e-ask-foot{display:flex;justify-content:flex-end;align-items:center;gap:6px}
        .e-ask-foot button{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:3px;cursor:pointer}
        .e-ask-del{background:none;color:#6B6B66}
        .e-ask-del:hover{background:rgba(0,0,0,.06);color:#111110}
        .e-ask-send{background:#111110;color:#fff}
        #edit-ask .e-ask-send:disabled{background:#D1D1D6;cursor:default}
      }
      @media print{#edit,#edit-bar,#edit-rail,#edit-status,#edit-layer,#edit-ask,#edit-layouts,#edit-copy{display:none}}`;
  }
  function buildEdit() {
    const css = document.createElement('style');
    css.id = 'edit-css';
    css.textContent = editCss();
    document.head.append(css);
    const layer = document.createElement('div');
    layer.id = 'edit-layer';
    layer.innerHTML = '<div class="e-marks"></div><div class="e-mark e-box" hidden></div><div class="e-mark e-sel" hidden></div><div class="e-mark e-hover" hidden></div>';
    const bar = document.createElement('div');
    bar.id = 'edit-bar';
    bar.innerHTML = '<span class="e-name"></span><div class="e-tools" hidden><span class="e-tools-label">Selection</span>' + tool('e-do-parent', 'Select parent', 'up') +
      tool('e-do-earlier', 'Move earlier', 'back') + tool('e-do-later', 'Move later', 'forward') +
      tool('e-do-duplicate', 'Duplicate', 'copy') + tool('e-do-detail', 'Add a detail it opens', 'detail') + tool('e-do-delete', 'Delete', 'trash') + '</div>' +
      '<div class="e-ask-tools" hidden>' + tool('e-ask-parent', 'Select parent', 'up') + tool('e-ask-child', 'Select child', 'down') +
      tool('e-ask-remove', 'Delete suggestion', 'trash') + tool('e-ask-save', 'Save suggestion', 'check') + '</div>' +
      '<div class="e-slide-tools"><span class="e-tools-label">Slide</span>' + tool('e-do-add', 'New slide', 'plus') +
      tool('e-do-copy-slide', 'Duplicate slide', 'copy') + tool('e-do-skip-slide', 'Skip slide', 'skip') +
      tool('e-do-drop-slide', 'Delete slide', 'trash') + '</div>' +
      (langs.length > 1 ? labelled('e-lang', '', 'lang', 'The language shown and edited; a click shows the next one (L)') : '') +
      '<div class="e-mode">' + labelled('e-mode-edit', 'Edit', 'pencil', 'A click on the slide selects, a double-click types') +
      labelled('e-mode-suggest', 'Suggest', 'bubble', 'A click on the slide suggests a change') + '</div>' +
      tool('e-do-undo', 'Undo', 'reset') +
      `<button type="button" class="e-save" aria-haspopup="true" aria-expanded="false" title="Save the deck, or a public copy to hand out">${icon('save')}<span>Save</span>${icon('chevron', 12)}</button>` +
      tool('e-show', 'Slide Show', 'play') + tool('e-present', 'Presenter View', 'display');
    bar.firstChild.textContent = document.title;
    const rail = document.createElement('div');
    rail.id = 'edit-rail';
    const status = document.createElement('div');
    status.id = 'edit-status';
    status.innerHTML = `<span class="e-where"></span><span class="e-missing" hidden></span><span class="e-skipped" hidden>${icon('skip', 12)}Skipped: not in the show</span><div class="e-status-buttons">` +
      `<button type="button" class="e-toggle-rail" aria-label="Thumbnails" aria-pressed="true" title="Show or hide the thumbnails">${icon('paneLeft')}</button>` +
      `<button type="button" class="e-notes" aria-label="Notes" title="Show or hide the notes">${icon('notes')}</button>` +
      `<button type="button" class="e-toggle-pane" aria-label="Side pane" aria-pressed="true" title="Show or hide the unsaved edits or suggestions">${icon('paneRight')}</button></div>`;
    const panel = document.createElement('div');
    panel.id = 'edit';
    panel.innerHTML =
      `<div class="e-pane e-suggestions"><div class="e-head">${icon('bubble')}Suggestions</div>` +
      `<div class="e-empty">${icon('bubble', 28)}Click an element on the slide to suggest a change. Click the background to pin a spot, or drag to box an area.</div>` +
      '<div class="e-list"></div><div class="e-foot">' + labelled('e-copy', 'Copy prompt', 'copy') + labelled('e-undo', 'Undo', 'reset') +
      labelled('e-clear', 'Clear', 'trash') + '</div></div>' +
      `<div class="e-pane e-edits"><div class="e-head">${icon('pencil')}Unsaved edits</div>` +
      `<div class="e-empty e-edits-empty">${icon('pencil', 28)}No unsaved edits. Double-click text to change it, or click an element to move, copy or delete it.</div>` +
      '<div class="e-list e-edits-list"></div><div class="e-foot">' + labelled('e-clear-edits', 'Clear', 'trash') + '</div></div>';
    const ask = document.createElement('div');
    ask.id = 'edit-ask';
    ask.hidden = true;
    ask.innerHTML = '<div class="e-ask-path"></div><textarea rows="1" placeholder="Describe the change"></textarea><div class="e-ask-foot">' +
      tool('e-ask-del', 'Delete suggestion', 'trash') + tool('e-ask-send', 'Save suggestion', 'up') + '</div>';
    const copyBox = document.createElement('div');
    copyBox.id = 'edit-copy';
    copyBox.hidden = true;
    const layouts = deckLayouts(), menu = layoutMenu(layouts);
    const $ = s => panel.querySelector(s);
    ed = { layer, menu, copyBox, marks: layer.firstChild, draft: layer.children[1], hover: layer.lastChild, list: $('.e-list'), empty: $('.e-empty'), copy: $('.e-copy'),
      clear: $('.e-clear'), undoSuggestions: $('.e-undo'), rail, thumbs: [], dragged: null, where: status.firstChild, missing: status.children[1], skipped: status.children[2], ask, ta: ask.querySelector('textarea'), path: ask.firstChild,
      send: ask.querySelector('.e-ask-send'), open: null, chain: [], level: 0, saved: [], undoTimer: null, key: 'deck:edit:' + location.pathname, items: [],
      outline: layer.children[2], tools: bar.querySelector('.e-tools'), modes: bar.querySelectorAll('.e-mode button'), undo: bar.querySelector('.e-do-undo'),
      save: bar.querySelector('.e-save'), sel: null, typing: null, seq: 0, done: [], unsaved: [], file: null, notesWere: '', slideLabels: [], add: bar.querySelector('.e-do-add'), skip: bar.querySelector('.e-do-skip-slide'), dropSlide: bar.querySelector('.e-do-drop-slide'),
      copySlide: bar.querySelector('.e-do-copy-slide'), slideTools: bar.querySelector('.e-slide-tools'),
      askTools: bar.querySelector('.e-ask-tools'), panes: [$('.e-edits'), $('.e-suggestions')], editList: $('.e-edits-list'), editEmpty: $('.e-edits-empty'), editClear: $('.e-clear-edits') };
    ed.undoSuggestions.hidden = true;
    matchThumbs();
    wireThumbDrag();
    // a suggestion still empty when the page went away is not kept
    try { ed.items = (JSON.parse(localStorage.getItem(ed.key)) || []).filter(s => s.note.trim()); } catch {}
    // the deck may have changed since they were made
    relocate();
    saveSuggestions();

    wireComposer();
    // a press anywhere else closes the composer too, and keeps what is being typed in the slide or the notes
    addEventListener('pointerdown', e => {
      if (ed.open && !ask.contains(e.target) && !ed.askTools.contains(e.target) && closeAsk()) drawEdit();
      if (ed.typing && !ed.typing.el.contains(e.target)) commitText();
      if (!menu.contains(e.target) && !ed.add.contains(e.target)) showLayouts(false);
      if (!copyBox.contains(e.target) && !ed.save.contains(e.target)) showBox();
      if (!notes.contains(e.target)) notes.blur();
    }, true);
    addEventListener('resize', () => { if (ed.open) placeAsk(); });

    wireLayer();
    wireNotes();
    // leaving the page loses what has not been saved, so the browser asks first
    addEventListener('beforeunload', e => {
      settle();
      if (ed.unsaved.length) e.preventDefault();
    });

    // the buttons never take focus, so Space and the arrows keep steering the deck, and the composer keeps what is typed in it
    for (const p of [bar, rail, panel, status, menu, copyBox, ed.path]) p.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    ed.modes.forEach((b, n) => b.addEventListener('click', () => setSuggesting(n === 1)));
    setSuggesting(suggesting);
    const clicks = {
      '.e-do-parent': () => select(ed.sel.parentElement),
      '.e-do-earlier': () => alter('Moved earlier', { kind: 'move', step: -1 }),
      '.e-do-later': () => alter('Moved later', { kind: 'move', step: 1 }),
      '.e-do-duplicate': () => alter('Duplicated', { kind: 'duplicate' }),
      '.e-do-delete': () => alter('Deleted', { kind: 'delete' }),
      '.e-do-detail': addDetail,
      // the same as in the composer, while it is open
      '.e-ask-parent': () => reselect(ed.level + 1),
      '.e-ask-child': () => reselect(ed.level - 1),
      '.e-ask-remove': () => ask.querySelector('.e-ask-del').click(),
      '.e-ask-save': () => ed.send.click(),
      '.e-do-add': () => layouts.length > 1 ? showLayouts(menu.hidden) : addSlide(layouts[0]),
      '.e-do-copy-slide': duplicateSlide,
      '.e-do-skip-slide': skipSlide,
      '.e-do-drop-slide': () => det >= 0 ? deleteDetail(slides[i], det) : deleteSlide(slides[i]),
      '.e-do-undo': undoChange,
      // a press closes the menu, and brings it back over the box that says which file to choose
      '.e-save': () => copyBox.hidden || ed.asking ? showCopy() : showBox(),
      // the show starts on this slide as a show does, with its builds still to come; E leaves with the slide as it looks here
      '.e-show': () => { edit(false); show(i); },
      '.e-present': () => act('s')
    };
    for (const [selector, fn] of Object.entries(clicks)) bar.querySelector(selector).addEventListener('click', fn);
    bar.querySelector('.e-lang')?.addEventListener('click', () => { settle(); setLang(nextLang()); });
    ed.undo.disabled = true;
    status.querySelector('.e-notes').addEventListener('click', () => act('n'));
    // a side pane folds away, and the slide takes its room; for this visit only
    const togglePane = (button, pane, set) => button.addEventListener('click', () => {
      pane.hidden = !pane.hidden;
      button.setAttribute('aria-pressed', !pane.hidden);
      set(!pane.hidden);
      fit();
    });
    togglePane(status.querySelector('.e-toggle-rail'), rail, on => { railOn = on; });
    togglePane(status.querySelector('.e-toggle-pane'), panel, on => { paneOn = on; });
    ed.undoSuggestions.addEventListener('click', () => {
      ed.items = ed.saved;
      // the deck may have changed since
      relocate();
      ed.undoSuggestions.hidden = true;
      saveSuggestions();
      drawEdit();
    });
    ed.copy.addEventListener('click', () => copyText(editPrompt()).then(ok => {
      ed.copy.lastChild.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(() => { ed.copy.lastChild.textContent = 'Copy prompt'; }, 2000);
    }));
    // a Clear wants a second click within 3 s
    const clickTwice = (button, fn) => button.addEventListener('click', () => {
      if (button.textContent === 'Clear') {
        button.lastChild.textContent = 'Click again';
        setTimeout(() => { button.lastChild.textContent = 'Clear'; }, 3000);
        return;
      }
      button.lastChild.textContent = 'Clear';
      fn();
    });
    clickTwice(ed.clear, () => {
      offerUndo();
      ed.items = [];
      saveSuggestions();
      drawEdit();
    });
    // takes back every unsaved edit, and stays on this slide
    clickTwice(ed.editClear, () => {
      const from = slides[i];
      while (ed.unsaved.length) removeEdit(ed.unsaved[0]);
      showSlide(from);
    });
    stage.append(layer);
    copyBox.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.matches('.e-save-go, .e-file-go')) saveDeck(b.matches('.e-file-go'));
      else saveAs(b.matches('.e-copy-go'));
    });
    document.body.append(bar, rail, status, panel, ask, menu, copyBox);
  }
  // the layouts New slide offers: those in the deck's <template data-deck="layouts">, or else one plain slide
  function deckLayouts() {
    const plain = document.createElement('template');
    plain.innerHTML = '<section class="slide">\n  <h2>New slide</h2>\n  <ul>\n    <li>First point</li>\n  </ul>\n</section>';
    const own = document.querySelector('template[data-deck="layouts"]')?.content.children;
    return own?.length ? [...own] : [plain.content.firstChild];
  }
  function layoutMenu(layouts) {
    const menu = document.createElement('div');
    menu.id = 'edit-layouts';
    menu.hidden = true;
    for (const layout of layouts) {
      const b = document.createElement('button');
      b.type = 'button';
      // its preview is this file opened as ?view, like a thumbnail, given its src when the menu first shows
      b.innerHTML = '<span class="e-thumb-frame"><iframe aria-hidden="true" tabindex="-1"></iframe></span><span></span>';
      b.lastChild.textContent = layout.dataset.layout;
      const f = b.querySelector('iframe');
      f.addEventListener('load', () => sendView(f, layout.outerHTML));
      b.addEventListener('click', () => addSlide(layout));
      menu.append(b);
    }
    return menu;
  }
  // drag a thumbnail to a gap between the others; drags of anything else are ignored
  function wireThumbDrag() {
    const gapAt = y => {
      const n = ed.thumbs.findIndex(t => { const r = t.getBoundingClientRect(); return y < r.top + r.height / 2; });
      return n < 0 ? ed.thumbs.length : n;
    };
    const markGap = n => ed.thumbs.forEach((t, k) => {
      t.classList.toggle('e-drop', k === n);
      t.classList.toggle('e-drop-end', k === n - 1 && n === ed.thumbs.length);
    });
    ed.rail.addEventListener('dragover', e => {
      if (!ed.dragged) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      markGap(gapAt(e.clientY));
    });
    ed.rail.addEventListener('dragleave', e => { if (!ed.rail.contains(e.relatedTarget)) markGap(-1); });
    ed.rail.addEventListener('drop', e => {
      if (!ed.dragged) return;
      e.preventDefault();
      const gap = gapAt(e.clientY), above = slides[gap - 1];
      moveSlide(ed.dragged, (above === ed.dragged ? slides[gap - 2] : above) || null);
    });
    ed.rail.addEventListener('dragend', () => {
      ed.dragged = null;
      markGap(-1);
    });
  }
  // the composer: typing saves as you go, Enter (or the round button) closes it, Shift+Enter is a new line, Esc closes it
  function wireComposer() {
    ed.ta.addEventListener('input', () => {
      ed.open.note = ed.ta.value;
      saveSuggestions();
      ed.list.querySelectorAll('.e-note')[ed.items.indexOf(ed.open)].textContent = ed.ta.value;
      ed.send.disabled = ed.askTools.lastChild.disabled = !ed.ta.value.trim();
      ed.copy.disabled = !ed.items.some(s => s.note.trim());
      drawCounts();
      placeAsk();
    });
    ed.ta.addEventListener('keydown', e => {
      // while the box is empty, ↑ and ↓ widen and narrow what is selected
      const step = !ed.ta.value && { ArrowUp: 1, ArrowDown: -1 }[e.key];
      if (step) {
        e.preventDefault();
        if (ed.chain[ed.level + step]) reselect(ed.level + step);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey && !e.isComposing) || e.key === 'Escape') {
        e.preventDefault();
        if (closeAsk()) drawEdit();
      }
    });
    ed.send.addEventListener('click', () => { if (closeAsk()) drawEdit(); });
    ed.ask.querySelector('.e-ask-del').addEventListener('click', () => {
      if (ed.open.note.trim()) offerUndo();
      ed.open.note = '';
      drawEdit();
    });
  }
  function wireLayer() {
    const layer = ed.layer;
    // the cursor outlines the element under it, unless a drag or the composer is under way
    layer.addEventListener('pointermove', e => {
      let el = !e.buttons && !ed.open && (suggesting ? pick : pickWhole)(e.clientX, e.clientY);
      if (el === ed.sel) el = null;  // it has its own outline
      ed.hover.hidden = !el;
      if (el) outline(ed.hover, frame(el));
    });
    layer.addEventListener('pointerleave', () => { ed.hover.hidden = true; });

    // Edit: a click selects what is there, or nothing on the background; a double-click types in its text
    layer.addEventListener('click', e => { if (!suggesting && e.target === layer) select(pickWhole(e.clientX, e.clientY)); });
    layer.addEventListener('dblclick', e => {
      const el = !suggesting && e.target === layer && textTarget(e.clientX, e.clientY);
      if (el) typeInto(el, e.clientX, e.clientY);
    });
    // what is being typed: Enter and Tab keep it, Esc takes it back, Shift+Enter is a new line
    stage.addEventListener('keydown', e => {
      if (!ed.typing || e.isComposing) return;
      const keep = (e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab';
      if (!keep && e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      commitText(!keep);
    });
    // Suggest: press, drag and let go on the slide: over 8 slide px of movement is a box, less is a click, which selects the
    // element there, or pins the spot on the background
    layer.addEventListener('pointerdown', e => {
      if (e.button) return;
      e.preventDefault();
      if (!suggesting) return;
      layer.setPointerCapture(e.pointerId);
      const a = at(e);
      let b = a;
      const big = () => Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) >= 8;
      const rect = () => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
      const move = ev => {
        b = at(ev);
        ed.draft.hidden = !big();
        outline(ed.draft, rect());
      };
      const done = ev => {
        layer.removeEventListener('pointermove', move);
        layer.removeEventListener('pointerup', done);
        layer.removeEventListener('pointercancel', done);
        ed.draft.hidden = true;
        if (ev.type !== 'pointerup') return;
        b = at(ev);
        const el = !big() && pick(ev.clientX, ev.clientY);
        if (big()) addSuggestion('box', rect());
        else if (el) addSuggestion('box', measure(el), el);
        else addSuggestion('pin', { x: a.x, y: a.y, w: 0, h: 0 });
      };
      layer.addEventListener('pointermove', move);
      layer.addEventListener('pointerup', done);
      layer.addEventListener('pointercancel', done);
    });
  }
  // the notes: changed when you leave them, as one step to undo; pasted text comes without its formatting
  function wireNotes() {
    notes.addEventListener('focus', () => {
      if (!notesOf(openDetail() || slides[i])) {
        notes.innerHTML = '<p><br></p>';
        getSelection().collapse(notes.firstChild, 0);
      }
      ed.notesWere = notes.innerHTML;
    });
    notes.addEventListener('blur', () => {
      const slide = slides[i], was = slide.innerHTML, before = twin(slide), text = textOf(notes), html = text ? notes.innerHTML : '';
      if (notes.innerHTML !== ed.notesWere) setNotes(openDetail() || slide, html);
      drawNotes();
      if (slide.innerHTML !== was) {
        change(slide, before, { what: text ? 'Changed notes' : 'Removed notes', detail: text && `"${clip(text, 60)}"`, op: { kind: 'notes', html, in: det } });
      }
    });
    notes.addEventListener('paste', e => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
  }
  // A thumbnail stands for a position in the deck, not for a slide: when slides move, each iframe is sent the slide now at
  // its position, because an iframe that moves in the DOM reloads. Each is this file opened as ?view, loaded lazily
  function addThumb() {
    const n = ed.thumbs.length, t = document.createElement('div');
    t.className = 'e-thumb';
    t.draggable = true;
    t.innerHTML = `<span class="e-thumb-n">${n + 1}</span><span class="e-thumb-frame"><iframe tabindex="-1" loading="lazy" title="Slide ${n + 1}"></iframe></span>` +
      `<span class="e-thumb-skip">${icon('skip', 28)}</span><span class="e-thumb-count" hidden></span>` + tool('e-thumb-del', 'Delete slide', 'close', 12) +
      '<div class="e-subs"></div>';
    const f = t.querySelector('iframe'), del = t.querySelector('.e-thumb-del'), subs = t.lastChild;
    f.addEventListener('load', () => sendThumb(n));
    f.src = here + '?view';
    t.addEventListener('click', e => {
      const sub = e.target.closest('.e-sub');
      show(n, true, sub ? [...subs.children].indexOf(sub) : -1);
    });
    t.addEventListener('dragstart', e => {
      if (suggesting) return e.preventDefault();
      ed.dragged = slides[n];
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
    });
    del.addEventListener('click', e => {
      e.stopPropagation();
      deleteSlide(slides[n]);
    });
    ed.thumbs.push(t);
    ed.rail.append(t);
  }
  function matchThumbs() {
    while (ed.thumbs.length < slides.length) addThumb();
    while (ed.thumbs.length > slides.length) ed.thumbs.pop().remove();
    ed.rail.classList.toggle('e-one', slides.length < 2);
    ed.dropSlide.disabled = det < 0 && slides.length < 2;
  }
  function saveSuggestions() { local.set(ed.key, ed.items); }
  // before deleting: remember the suggestions, and offer them back for a few seconds
  function offerUndo() {
    ed.saved = ed.items.filter(s => s.note.trim()).map(s => ({ ...s }));
    ed.undoSuggestions.hidden = false;
    clearTimeout(ed.undoTimer);
    ed.undoTimer = setTimeout(() => { ed.undoSuggestions.hidden = true; }, 6000);
  }
  // the pointer, and an element's box, in the slide's 1920x1080 frame
  function layerBox() {
    const L = ed.layer.getBoundingClientRect();
    return { L, k: L.width / 1920 };
  }
  function at(e) {
    const { L, k } = layerBox();
    return { x: Math.round(clamp((e.clientX - L.left) / k, 0, 1920)), y: Math.round(clamp((e.clientY - L.top) / k, 0, 1080)) };
  }
  function frame(el) {
    const { L, k } = layerBox(), q = el.getBoundingClientRect();
    return { x: (q.left - L.left) / k, y: (q.top - L.top) / k, w: q.width / k, h: q.height / k };
  }
  function measure(el) {
    const f = frame(el);
    return { x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.w), h: Math.round(f.h) };
  }
  function outline(m, r) { m.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`; }
  // what the edit view works on: the open detail, or else the slide, so that nothing behind a detail can be picked
  const scope = () => openDetail() || slides[i];
  // the deepest element of what is edited at a point of the window, or nothing on its background; a drawing counts as one
  function pick(x, y) {
    const within = scope(), el = document.elementsFromPoint(x, y).find(e => within.contains(e) && !e.closest(OFF_SLIDE) && !e.closest('[data-lang-off]'));
    return el === within ? null : el?.closest('svg') || el;
  }
  // text as written in the deck, not as styled: its text nodes joined by spaces, without the notes and the slide counter
  function textOf(el) {
    const c = el.cloneNode(true), w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT), t = [];
    c.querySelectorAll(OFF_SLIDE).forEach(n => n.remove());
    while (w.nextNode()) t.push(w.currentNode.data);
    return t.join(' ').replace(/\s+/g, ' ').trim();
  }
  const clip = (t, n) => t.length > n ? t.slice(0, n - 1) + '…' : t;
  const esc = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // a selector for an element in the deck as it is now
  function pathOf(el) {
    const steps = [];
    for (; el.id !== 'stage'; el = el.parentElement) steps.unshift(`${el.localName}:nth-child(${[...el.parentElement.children].indexOf(el) + 1})`);
    return '#stage > ' + steps.join(' > ');
  }
  const slideOf = el => slides.find(x => x.contains(el));
  const ownClasses = el => [...el.classList].filter(c => c !== 'on' && c !== 'current');
  function headingOf(slide) {
    const h = slide.querySelector('h1, h2, h3, blockquote');
    return h ? clip(textOf(h), 60) : '';
  }
  // what a suggestion records about its element: how the deck writes it, and where to find it again
  function describe(el) {
    // its HTML as written in the deck: without the slide counter and the classes the engine adds
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.counter').forEach(c => c.remove());
    [clone, ...clone.querySelectorAll('.on, .current')].forEach(c => c.classList.remove('on', 'current'));
    return { heading: headingOf(slideOf(el)), whole: slides.includes(el), path: pathOf(el),
      el: el.localName + ownClasses(el).map(c => '.' + c).join(''),
      text: clip(textOf(el), 80), html: clip(clone.outerHTML.replace(/ class=""/g, ''), 800) };
  }
  // is this element, or slide, still what the suggestion was about?
  function same(el, s) {
    if (s.whole) return headingOf(el) === s.heading;
    return el.localName === s.el.split('.')[0] && (s.text ? clip(textOf(el), 80) === s.text : describe(el).html === s.html);
  }
  // Find a suggestion's element in the deck as it is now: at its stored path if that still matches, or else the single
  // element that matches. One loaded from storage is looked for on every slide; once it has a home slide, only there.
  // No match, several matches or a deleted home slide make it stale
  function locate(s) {
    const home = s[HOME];
    if (home && !slides.includes(home)) {
      s.stale = true;
      s.slide = Math.min(s.slide, slides.length - 1);
      return;
    }
    if (home) {
      s.slide = slides.indexOf(home);
      s.path = s.path.replace(/^#stage > \S+/, pathOf(home));
    }
    let hit = null;
    try { hit = document.querySelector(s.path); } catch {}
    const within = home ? [home] : slides;
    const inDeck = hit && slideOf(hit) && !hit.closest(OFF_SLIDE) && same(hit, s);
    const found = inDeck ? [hit] : (s.whole ? within : within.flatMap(x => [...x.querySelectorAll('*')]))
      .filter(el => !el.closest(OFF_SLIDE) && same(el, s));
    s.stale = found.length !== 1;
    if (s.stale) s.slide = Math.min(s.slide, slides.length - 1);
    else Object.assign(s, describe(found[0]), { slide: slides.indexOf(slideOf(found[0])) });
    s[HOME] = slides[s.slide];
  }
  // the deck has changed: the suggestions go where their elements are now
  function relocate() {
    ed.items.forEach(locate);
    ed.items.sort((x, y) => x.slide - y.slide);
  }
  // a suggestion's element, or nothing when that is gone
  const elementOf = s => s.stale ? null : document.querySelector(s.path);
  // select another level of what the open suggestion is about; its note stays
  function reselect(n) {
    const s = ed.open, el = ed.chain[n];
    ed.level = n;
    Object.assign(s, describe(el), measure(el), { kind: 'box', picked: true });
    saveSuggestions();
    ed.open = null;  // so that drawing does not drop it while it is still empty
    drawEdit();
    openAsk(s, true);
  }
  function addSuggestion(kind, r, el) {
    const slide = slides[i], picked = !!el;
    // what it is about: the element picked, or the one under the point (of a box: its centre), widened until it covers
    // 85 % of the box, so a box drawn a little loose still lands on the element it was drawn around
    const { L, k } = layerBox();
    const within = scope();
    el ||= pick(L.left + (r.x + r.w / 2) * k, L.top + (r.y + r.h / 2) * k) || within;
    const cover = q => Math.max(0, Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x)) *
      Math.max(0, Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y)) / (r.w * r.h);
    while (r.w && r.h && el !== within && cover(frame(el)) < .85) el = el.parentElement;
    const s = { slide: i, [HOME]: slide, det, kind, ...r, ...describe(el), picked, note: '' };
    ed.items.push(s);
    ed.items.sort((x, y) => x.slide - y.slide);
    saveSuggestions();
    drawEdit();
    openAsk(s);
  }
  // open the composer for a suggestion, under what it is about (above it when there is no room), left of the panel
  function openAsk(s, sameLevels) {
    if (!sameLevels) {
      ed.chain = [];
      ed.level = 0;
      // from the element up to its slide; a pin only has the slide
      // from the element up to its detail, or else its slide; a pin only has that
      const top = s.det >= 0 && details(slides[s.slide])[s.det];
      for (let el = elementOf(s); el && el.id !== 'stage'; el = el.parentElement) {
        ed.chain.push(el);
        if (el === top) break;
      }
    }
    ed.open = s;
    ed.ask.hidden = false;
    ed.ta.value = s.note;
    ed.send.disabled = ed.askTools.lastChild.disabled = !s.note.trim();
    ed.hover.hidden = true;
    ed.askTools.hidden = false;
    ed.askTools.querySelector('.e-ask-parent').disabled = !ed.chain[ed.level + 1];
    ed.askTools.querySelector('.e-ask-child').disabled = !ed.chain[ed.level - 1];
    drawLevels(s);
    placeAsk();
    ed.ta.focus();
  }
  // the top line of the composer: the slide, then the levels that can be selected, the three nearest the current one
  function drawLevels(s) {
    const last = ed.chain.length - 1, from = Math.max(0, Math.min(ed.level - 1, last - 3));
    const crumb = n => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'e-crumb' + (n === ed.level && s.kind !== 'pin' ? ' e-at' : '');
      const el = ed.chain[n], cls = ownClasses(el)[0];
      b.textContent = n === last ? (el.matches('.detail') ? `Detail ${s.det + 1}` : `Slide ${s.slide + 1}`) : el.localName + (cls ? '.' + cls : '');
      b.addEventListener('click', () => reselect(n));
      return b;
    };
    const tail = s.kind === 'pin' ? 'point' : s.el + (s.text ? ` "${s.text}"` : '');
    const after = !ed.chain.length || s.kind === 'pin' ? tail : ed.level < last && s.text ? `"${s.text}"` : '';
    const parts = last < 0 ? [`Slide ${s.slide + 1}`] : [crumb(last)];
    if (from + 3 < last) parts.push('…');
    if (s.kind !== 'pin') for (let n = Math.min(from + 2, last - 1); n >= from; n--) parts.push(crumb(n));
    ed.path.replaceChildren(...parts.flatMap((p, n) => n ? [' › ', p] : [p]));
    if (after) ed.path.append((s.kind === 'pin' || !ed.chain.length ? ' › ' : ' ') + after);
  }
  function placeAsk() {
    const s = ed.open, a = ed.ask, { L, k } = layerBox();
    ed.ta.style.height = 'auto';
    ed.ta.style.height = ed.ta.scrollHeight + 'px';
    let top = L.top + (s.y + s.h) * k + 12;
    // above leaves room for the mark's number, 30 px on screen
    if (top + a.offsetHeight > innerHeight - 8) top = Math.max(BAR_H + 8, L.top + s.y * k - 30 - 12 - a.offsetHeight);
    const rail = railOn ? RAIL_W : 0, pane = paneOn ? PANE_W : 0;
    a.style.left = clamp(L.left + s.x * k, rail + 8, innerWidth - pane - a.offsetWidth - 8) + 'px';
    a.style.top = top + 'px';
  }
  // close the composer; a suggestion left empty goes with it, and then the list needs drawing again
  function closeAsk() {
    const s = ed.open;
    ed.open = null;
    ed.ask.hidden = ed.askTools.hidden = true;
    ed.ta.blur();  // at once: the next key steers the deck, it does not go to the box that was hidden
    if (!s || s.note.trim() || !ed.items.includes(s)) return false;
    ed.items.splice(ed.items.indexOf(s), 1);
    saveSuggestions();
    return true;
  }
  function drawCounts() {
    ed.thumbs.forEach((t, n) => {
      const c = t.querySelector('.e-thumb-count'), count = ed.items.filter(s => s.slide === n && s.note.trim()).length;
      c.hidden = !count;
      c.textContent = count;
    });
  }
  // the row of an unsaved edit: a click goes to the slide, and selects the element if it is still there.
  // × removes the edit, and wants a second click within 3 s when later edits can't stand without it
  function unsavedRow(c) {
    const row = document.createElement('div');
    row.className = 'e-change';
    row.innerHTML = `<div class="e-note">${esc(c.what)}</div><div class="e-el">${esc(c.detail || '')}</div>` + tool('e-change-del', 'Remove edit', 'close', 12);
    row.addEventListener('click', () => {
      if (!slides.includes(c.slide)) return;
      showSlide(c.slide, c.det);
      const el = findById(c.slide, c.shows);
      if (el) select(el);
    });
    const del = row.lastChild;
    del.addEventListener('click', e => {
      e.stopPropagation();
      const later = without(c).gone.length - 1;
      if (!later || del.classList.contains('e-armed')) return removeEdit(c);
      del.classList.add('e-armed');
      const warn = document.createElement('div');
      warn.className = 'e-change-warn';
      warn.textContent = `Also removes ${later} later edit${later > 1 ? 's' : ''} that can't stand without it. Click × again.`;
      del.before(warn);
      setTimeout(() => { warn.remove(); del.classList.remove('e-armed'); }, 3000);
    });
    return row;
  }
  function slideLabel(n) {
    const label = document.createElement('button');
    label.type = 'button';
    label.addEventListener('click', () => { if (n >= 0) show(n, true); });
    return label;
  }
  // The unsaved edits, grouped by slide, those of deleted slides first. Rows and labels are reused and moved into place,
  // not rebuilt: a pointerdown on one can commit text and redraw this list, and the click that follows must still land on it
  function drawUnsaved() {
    ed.editEmpty.hidden = !!ed.unsaved.length;
    ed.editClear.disabled = !ed.unsaved.length;
    const list = [];
    let shown = null;
    [...ed.unsaved].sort((x, y) => slides.indexOf(x.slide) - slides.indexOf(y.slide)).forEach(c => {
      const n = slides.indexOf(c.slide);
      if (n !== shown) {
        shown = n;
        const head = headingOf(c.slide), label = ed.slideLabels[n] ||= slideLabel(n);
        label.className = 'e-slide' + (n === i ? ' e-cur' : '');
        label.textContent = n < 0 ? 'Deleted slides' : `Slide ${n + 1}${head ? ' · ' + head : ''}`;
        list.push(label);
      }
      list.push(c.row ||= unsavedRow(c));
    });
    const on = ed.editList.children;
    list.forEach((node, k) => { if (on[k] !== node) ed.editList.insertBefore(node, on[k] || null); });
    while (on.length > list.length) ed.editList.lastChild.remove();
  }
  function suggestionRow(s, n, cur) {
    const item = document.createElement('div');
    item.className = 'e-item' + cur + (s.stale ? ' e-stale' : '');
    item.innerHTML =
      `<span class="e-n">${pad(n + 1)}</span><div class="e-note">${esc(s.note)}</div>` +
      `<div class="e-el">${s.stale ? '<span class="e-changed">Changed</span>' : ''}${esc(s.text ? '"' + s.text + '"' : s.el)}</div>` +
      tool('e-del', 'Remove suggestion', 'close', 12);
    item.addEventListener('click', e => {
      if (e.target.closest('.e-del')) return;
      show(s.slide, true, s.det ?? -1);
      openAsk(s);
    });
    item.querySelector('.e-del').addEventListener('click', () => { offerUndo(); ed.items.splice(n, 1); saveSuggestions(); drawEdit(); });
    return item;
  }
  function suggestionMark(s, n, item) {
    const m = document.createElement('div');
    m.className = 'e-mark e-' + s.kind + (s.stale ? ' e-stale' : '');
    outline(m, s);
    m.innerHTML = `<span>${pad(n + 1)}</span>`;
    // the outside-press handler has already closed any other composer; this one may have gone with it if it was empty.
    // From Edit it goes to Suggest, where the suggestion's pane and buttons are
    m.addEventListener('pointerdown', e => {
      e.stopPropagation();
      e.preventDefault();
      if (!ed.items.includes(s)) return;
      setSuggesting(true);
      openAsk(s);
    });
    // the row and the mark light up together
    const light = (from, to) => {
      from.addEventListener('mouseenter', () => to.classList.add('e-lit'));
      from.addEventListener('mouseleave', () => to.classList.remove('e-lit'));
    };
    light(item, m);
    light(m.firstChild, item);
    return m;
  }
  // the list in the panel, one label per slide, and the marks on the current slide, numbered alike; closes the composer
  function drawEdit() {
    closeAsk();
    drawUnsaved();
    ed.hover.hidden = true;
    const all = details(slides[i]);
    ed.where.textContent = `Slide ${i + 1} of ${slides.length}` + (det >= 0 ? `, detail ${det + 1} of ${all.length}` : '');
    // the texts of the deck that have no version in the language shown, said in the status bar and dimmed on the slide
    const missing = new Set([...stage.querySelectorAll('[data-lang-missing]')].map(x => versionsAround(x)[0])).size;
    ed.missing.hidden = !missing;
    ed.missing.textContent = `${missing} text${missing > 1 ? 's' : ''} without ${cur?.toUpperCase()}`;
    const langButton = document.querySelector('#edit-bar .e-lang');
    if (langButton) {
      langButton.lastChild.textContent = cur.toUpperCase();
      langButton.setAttribute('aria-label', `Language: ${cur.toUpperCase()}, show ${nextLang().toUpperCase()}`);
    }
    ed.thumbs.forEach((t, n) => {
      t.classList.toggle('e-cur', n === i && det < 0);
      t.classList.toggle('e-skip', skips(slides[n]));
      t.querySelectorAll('.e-sub').forEach((sub, k) => {
        sub.classList.toggle('e-cur', n === i && k === det);
        sub.classList.toggle('e-skip', skips(details(slides[n])[k]));
      });
    });
    // with a detail open, the slide section of the toolbar acts on the detail: Skip and Delete, and nothing that adds slides
    const shown = openDetail(), what = shown ? 'detail' : 'slide';
    ed.slideTools.querySelector('.e-tools-label').textContent = shown ? 'Detail' : 'Slide';
    ed.add.hidden = ed.copySlide.hidden = !!shown;
    for (const [b, verb] of [[ed.skip, 'Skip'], [ed.dropSlide, 'Delete']]) {
      b.setAttribute('aria-label', `${verb} ${what}`);
      b.title = `${verb} ${what}`;
    }
    ed.dropSlide.disabled = !shown && slides.length < 2;
    ed.skip.setAttribute('aria-pressed', skips(shown || slides[i]));
    ed.skipped.hidden = !skips(slides[i]) && !skips(shown);
    ed.skipped.lastChild.textContent = skips(slides[i]) ? 'Skipped: not in the show' : 'Skipped: does not open in the show';
    ed.thumbs[i].scrollIntoView({ block: 'nearest' });
    drawCounts();
    ed.marks.replaceChildren();
    ed.list.replaceChildren();
    let moved = false;
    ed.items.forEach((s, n) => {
      const cur = s.slide === i ? ' e-cur' : '';
      // an element selected on this slide may have moved: its outline goes with it
      const live = s.picked && s.slide === i && (s.det ?? -1) === det && elementOf(s);
      if (live) {
        const r = measure(live);
        if (r.w && r.h) moved = Object.assign(s, r);
      }
      if (s.slide !== ed.items[n - 1]?.slide) {
        const go = slideLabel(s.slide);
        go.className = 'e-go' + cur;
        go.textContent = `Slide ${s.slide + 1}${s.heading ? ' · ' + s.heading : ''}`;
        ed.list.append(go);
      }
      const item = suggestionRow(s, n, cur);
      ed.list.append(item);
      if (s.slide === i && (s.det ?? -1) === det) ed.marks.append(suggestionMark(s, n, item));
    });
    if (moved) saveSuggestions();
    ed.copy.disabled = !ed.items.some(s => s.note.trim());
    ed.clear.disabled = !ed.items.length;
    ed.empty.hidden = !!ed.items.length;
  }
  // Markdown for an agent working on the deck: its file, then per suggestion its slide, place, element and note
  function editPrompt() {
    // the file name, or its folder for an index.html, which is how such a deck is usually known
    const parts = decodeURIComponent(location.pathname).split('/');
    const last = parts.pop() || 'index.html';
    const file = last === 'index.html' ? [parts.filter(Boolean).pop(), last].filter(Boolean).join('/') : last;
    return `Improve the deck \`${file}\` with the suggestions below. Slides are the \`<section class="slide">\` elements, ` +
      'numbered from 1 in document order. Positions are in the 1920×1080 slide frame, origin top left. ' +
      'Each Element is a CSS selector for it in the deck as it was when suggested. ' +
      "Keep to the deck's existing conventions.\n\n" +
      ed.items.filter(s => s.note.trim()).map((s, n) =>
        `## ${n + 1}. Slide ${s.slide + 1}${s.heading ? ': ' + s.heading : ''}\n\n` +
        `Where: ${s.kind === 'pin' ? `point x ${s.x}, y ${s.y}` : `box x ${s.x}-${s.x + s.w}, y ${s.y}-${s.y + s.h}`}, ` +
        `on \`${s.el}\`${s.text ? ` "${s.text}"` : ''}\n\n` +
        `Element: \`${s.path}\`\n\n` +
        (s.stale ? 'This element has changed since the suggestion was made, so it may already be done.\n\n' : '') +
        `Suggestion: ${s.note.trim()}`).join('\n\n') + '\n';
  }
  function setSuggesting(on) {
    settle();
    select(null);
    suggesting = on;
    store.set(on ? 'suggest' : 'edit', MODE_KEY);
    notes.contentEditable = !on;
    showLayouts(false);
    ed.add.parentElement.hidden = on;
    ed.rail.classList.toggle('e-suggest', on);
    ed.modes.forEach((b, n) => b.setAttribute('aria-pressed', on === (n === 1)));
    ed.panes.forEach((p, n) => { p.hidden = on !== (n === 1); });
  }
  // what a click selects in Edit: a drawing or a code panel counts as one, as neither is typed in
  function pickWhole(x, y) {
    const el = pick(x, y);
    return el?.closest('svg, .term, pre') || el;
  }
  // the block around a point, if it holds nothing but text and inline elements; a slide's layout elements do not qualify
  // In a deck with languages, the version shown of a text is typed in on its own, inline or not: the block around it would
  // hold the other versions too, which would go when its text is typed over
  function textTarget(x, y) {
    let el = pickWhole(x, y);
    if (!el || el.matches('svg, .term, pre')) return null;
    const version = el.closest('[lang]');
    if (versioned(version) && scope().contains(version) && !version.hasAttribute('data-lang-off')) el = version;
    else while (getComputedStyle(el).display === 'inline') el = el.parentElement;
    const shown = c => !c.hasAttribute('data-lang-off');
    return el !== scope() && el.textContent.trim() && [...el.children].filter(shown).every(c => getComputedStyle(c).display.startsWith('inline'))
      && ![...el.children].some(c => !shown(c)) ? el : null;
  }
  // the element next to this one, passing over the engine's counter and the notes
  function neighbour(el, step) {
    do el = step < 0 ? el.previousElementSibling : el.nextElementSibling;
    while (el?.matches(OFF_SLIDE));
    return el;
  }
  function select(el) {
    ed.sel = el;
    ed.hover.hidden = true;
    ed.outline.hidden = ed.tools.hidden = !el;
    if (!el) return;
    outline(ed.outline, frame(el));
    ed.tools.querySelector('.e-do-parent').disabled = el.parentElement === scope();
    const run = versioned(el) ? versionsAround(el) : [el];
    ed.tools.querySelector('.e-do-earlier').disabled = !neighbour(run[0], -1);
    ed.tools.querySelector('.e-do-later').disabled = !neighbour(run.at(-1), 1);
  }
  const isSpace = n => n?.nodeType === Node.TEXT_NODE && !n.data.trim();
  // A copy of an element in which every node has the id of its original, so that an edit recorded against the copy can be
  // replayed on the same element later, wherever it has moved to
  function twin(el) {
    const copy = el.cloneNode(true), theirs = [copy, ...copy.querySelectorAll('*')];
    [el, ...el.querySelectorAll('*')].forEach((x, k) => {
      if (!elementIds.has(x)) elementIds.set(x, ++lastElementId);
      elementIds.set(theirs[k], elementIds.get(x));
    });
    return copy;
  }
  const findById = (root, id) => id && [root, ...root.querySelectorAll('*')].find(x => elementIds.get(x) === id);
  // two elements trade places; the white space around them in the source stays where it is
  function swapNodes(a, b) {
    const hole = document.createComment('');
    a.replaceWith(hole);
    b.replaceWith(a);
    hole.replaceWith(b);
  }
  // a copy without the ids of the original; a copied detail gets an id of its own, and what opens it in the copy follows
  function copyOf(el) {
    const copy = el.cloneNode(true), taken = new Set([...document.querySelectorAll('[id]')].map(n => n.id));
    [copy, ...copy.querySelectorAll('[id]')].filter(n => !n.closest('svg')).forEach(n => {
      if (!n.matches('.detail')) return n.removeAttribute('id');
      let k = 2;
      while (taken.has(`${n.id}-${k}`)) k++;
      const id = `${n.id}-${k}`;
      taken.add(id);
      copy.querySelectorAll('[data-detail]').forEach(o => { if (o.dataset.detail === n.id) o.dataset.detail = id; });
      n.id = id;
    });
    return copy;
  }
  function drop(el) {
    if (isSpace(el.previousSibling)) el.previousSibling.remove();
    el.remove();
  }
  function nameOf(el) {
    const t = clip(textOf(el), 40);
    return t ? `"${t}"` : el.localName;
  }
  // the notes of a slide or of a detail; new ones go at the end of it, before what the engine added
  function setNotes(owner, html) {
    let n = notesOf(owner);
    if (!html) return n?.remove();
    if (!n) {
      n = document.createElement('div');
      n.className = 's-notes';
      // in a detail, on a line of its own before </aside>, indented like the rest of it
      const end = owner.querySelector(':scope > .counter, :scope > .detail-close') || owner.lastChild;
      if (owner.matches('.detail') && isSpace(end?.previousSibling)) end.previousSibling.before(end.previousSibling.cloneNode(), '  ', n);
      else end ? end.before(n) : owner.append(n);
    }
    n.innerHTML = html;
  }
  // where a new detail goes in a slide: after its last detail, or else before its notes and its counter
  function detailSpot(slide) {
    const last = details(slide).at(-1);
    return last ? { after: last } : { before: notesOf(slide) || slide.querySelector(':scope > .counter') };
  }
  // the selected element opens a new detail, which shows; it starts as a heading and a line of text, ready to type in
  function addDetail() {
    const el = ed.sel, slide = slideOf(el), before = twin(slide), taken = id => document.getElementById(id);
    let n = 1;
    while (taken('detail-' + n)) n++;
    const made = document.createElement('aside');
    made.className = 'detail';
    made.id = 'detail-' + n;
    made.innerHTML = '\n  <h2>Detail</h2>\n  <p>What to say about it</p>\n';
    const op = { kind: 'detail', id: elementIds.get(el), made: twin(made) };
    perform(slide, op);
    change(slide, before, { what: 'Added detail', detail: nameOf(el), op });
    show(slides.indexOf(slide), true, details(slide).findIndex(x => x.id === made.id));
  }
  // Delete the k-th detail of a slide, and the data-detail of what opened it. Deleting the detail on view goes on to the
  // one now in its place, or else the one before, or else its slide, as deleting a slide does; deleting another leaves
  // the view where it is. An undo opens the detail again
  function deleteDetail(slide, k) {
    settle();
    const x = details(slide)[k], open = openDetail(), onIt = open === x, before = twin(slide), op = { kind: 'delete', id: idOf(x) };
    perform(slide, op);
    change(slide, before, { what: 'Deleted detail', detail: nameOf(x), op, det: op.id });
    if (onIt) show(slides.indexOf(slide), true, Math.min(k, details(slide).length - 1));
    else showSlide(slides[i], open ? idOf(open) : 0);
  }
  // Delete, duplicate or move every version of a text together. A copy comes after the last version, its versions in the
  // same order; a move goes past the versions of the text next to it, or past one element
  function performAll(root, el, op) {
    const run = versionsAround(el), first = run[0], last = run.at(-1);
    if (op.kind === 'delete') {
      run.forEach(drop);
      return true;
    }
    if (op.kind === 'duplicate') {
      const lead = isSpace(first.previousSibling) ? first.previousSibling.data : '\n';
      const made = twin(op.made), copies = run.map(x => x === el ? made : twin(copyOf(x)));
      last.after(...copies.flatMap(c => [lead, c]));
      return true;
    }
    // a move swaps the text with what is next to it: the versions of the text there, or one element
    const near = op.step < 0 ? neighbour(first, -1) : neighbour(last, 1);
    if (!near) return false;
    const other = versioned(near) ? versionsAround(near) : [near];
    const [a, b] = op.step < 0 ? [other, run] : [run, other];
    // the nodes of b, from its first to its last element with what is between them, go in front of a
    const span = [];
    for (let n = b[0]; n; n = n.nextSibling) { span.push(n); if (n === b.at(-1)) break; }
    const gap = isSpace(b[0].previousSibling) ? b[0].previousSibling.cloneNode() : document.createTextNode('\n');
    a[0].before(...span, gap);
    // the white space that was before b goes with it
    const left = a.at(-1).nextSibling;
    if (isSpace(left) && isSpace(left.nextSibling)) left.remove();
    return true;
  }
  // apply an edit to a slide or to a copy of one; false, with nothing changed, if its element is gone
  function perform(root, op) {
    if (op.kind === 'notes') {
      const owner = op.in >= 0 ? details(root)[op.in] : root;
      if (!owner) return false;
      setNotes(owner, op.html);
      return true;
    }
    if (op.kind === 'skip') {
      const target = op.id ? findById(root, op.id) : root;
      target?.toggleAttribute('data-skip', op.on);
      return !!target;
    }
    const el = findById(root, op.id);
    if (el && ['delete', 'duplicate', 'move'].includes(op.kind) && versioned(el)) return performAll(root, el, op);
    const other = el && op.kind === 'move' && neighbour(el, op.step);
    if (!el || (op.kind === 'move' && !other)) return false;
    if (op.kind === 'move') swapNodes(el, other);
    if (op.kind === 'delete') {
      // a detail takes with it the data-detail of what opened it, and the aria-expanded that made it look like an opener
      if (el.matches('.detail')) root.querySelectorAll('[data-detail]').forEach(o => {
        if (o.dataset.detail === el.id) ['data-detail', 'aria-expanded'].forEach(a => o.removeAttribute(a));
      });
      drop(el);
    }
    if (op.kind === 'detail') {
      const made = twin(op.made), spot = detailSpot(root);
      el.dataset.detail = made.id;
      spot.after ? spot.after.after('\n  ', made) : spot.before.before(made, '\n  ');
    }
    if (op.kind === 'text') el.replaceChildren(...twin(op.tree).childNodes);
    if (op.kind === 'duplicate') el.after(...(isSpace(el.previousSibling) ? [el.previousSibling.cloneNode()] : []), twin(op.made));
    return true;
  }
  // Change the selected element; a copy is what is selected next. A text in several languages is changed as a whole:
  // deleting, duplicating or moving one version does the same to the others, so the languages keep in step
  function alter(what, op) {
    const el = ed.sel, slide = slideOf(el), before = twin(slide), detail = nameOf(el);
    op.id = idOf(el);
    if (op.kind === 'duplicate') op.made = twin(copyOf(el));
    perform(slide, op);
    const shows = op.made ? elementIds.get(op.made) : op.id;
    ed.sel = findById(slide, shows) || null;
    change(slide, before, { what, detail, shows, op });
  }
  // An edit remembers the detail open when it was made, so that taking it back, or going to it from its row, opens it
  // again. A detail is known by the id its element shares with its copies, as the edit view replaces slides by copies
  const idOf = el => {
    if (!elementIds.has(el)) elementIds.set(el, ++lastElementId);
    return elementIds.get(el);
  };
  const detailIn = (slide, id) => id ? details(slide).findIndex(x => elementIds.get(x) === id) : -1;
  function remember(record) {
    record.seq = ++ed.seq;
    record.det ??= openDetail() ? idOf(openDetail()) : 0;
    ed.done.push(record);
    ed.unsaved.push(record);
  }
  function change(slide, before, edit) {
    remember({ slide, tree: before, ...edit });
    afterChange();
    sendThumb(slides.indexOf(slide));
  }
  // restore a slide's contents, and whether it is skipped, from a snapshot
  function putBack(slide, tree) {
    const was = skips(slide);
    slide.replaceChildren(...tree.childNodes);
    slide.toggleAttribute('data-skip', skips(tree));
    renumber();
    // the numbers leave skipped slides out, so one skipped or shown again redraws every thumbnail
    slides.forEach((s, n) => { if (s === slide || skips(slide) !== was) sendThumb(n); });
  }
  // Put the slides in this order. Each takes along the whitespace and comment before it, as such a comment usually names
  // the slide; whatever follows the last slide stays at the end
  function arrange(order) {
    const end = slides.at(-1).nextSibling, was = [...slides];
    for (const s of slides) {
      const lead = [];
      for (let n = s.previousSibling; n && n.nodeType !== Node.ELEMENT_NODE; n = n.previousSibling) lead.unshift(n);
      leads.set(s, lead);
      [...lead, s].forEach(n => n.remove());
    }
    for (const s of order) stage.insertBefore(s, end).before(...leads.get(s) || ['\n\n']);
    slides.splice(0, slides.length, ...order);
    renumber();
    matchThumbs();
    // counters show the total, so a new slide count redraws every thumbnail; otherwise only the positions that changed
    slides.forEach((s, n) => { if (s !== was[n] || order.length !== was.length) sendThumb(n); });
  }
  // the order after a slide edit, or null if it can't apply: its slide or the one it goes after is gone, or no slide would be left
  function place(order, op) {
    if (!op.added && !order.includes(op.slide)) return null;
    const rest = order.filter(s => s !== op.slide);
    if (op.gone) return rest.length ? rest : null;
    if (op.after && !rest.includes(op.after)) return null;
    rest.splice(op.after ? rest.indexOf(op.after) + 1 : 0, 0, op.slide);
    return rest;
  }
  // go to a slide after a change, with the detail that has this id open if it is still there; a slide no longer in the
  // deck leaves the view at the same place
  const showSlide = (slide, id = 0) => {
    const n = slides.includes(slide) ? slides.indexOf(slide) : i;
    show(n, true, detailIn(slides[n], id));
  };
  function changeOrder(what, op, showing) {
    settle();
    const head = headingOf(op.slide);
    remember({ slide: op.slide, order: [...slides], what, detail: head && `"${head}"`, op });
    arrange(place(slides, op));
    afterChange(showing);
  }
  function showLayouts(on) {
    ed.menu.hidden = !on;
    ed.add.setAttribute('aria-expanded', on);
    if (!on) return;
    ed.menu.querySelectorAll('iframe:not([src])').forEach(f => { f.src = here + '?view'; });
    const r = ed.add.getBoundingClientRect();
    ed.menu.style.top = r.bottom + 4 + 'px';
    ed.menu.style.right = innerWidth - r.right + 'px';
  }
  function addSlide(layout) {
    showLayouts(false);
    const slide = layout.cloneNode(true);
    slide.removeAttribute('data-layout');
    changeOrder('Added slide', { slide, after: slides[i], added: true }, slide);
  }
  function duplicateSlide() {
    const slide = copyOf(slides[i]);
    changeOrder('Duplicated slide', { slide, after: slides[i], added: true }, slide);
  }
  // move a slide to right after another, or to the front; where it is already is no edit
  function moveSlide(slide, after) {
    if ((slides[slides.indexOf(slide) - 1] || null) !== after) changeOrder('Moved slide', { slide, after }, slide);
  }
  function stepSlide(step) {
    const n = i + step;
    if (slides[n]) moveSlide(slides[i], slides[step < 0 ? n - 1 : n] || null);
  }
  function deleteSlide(slide) {
    changeOrder('Deleted slide', { slide, gone: true }, slides[i]);
  }
  // Skip the open detail, or else the current slide, or stop skipping it. A skipped slide changes the numbers on the
  // others; a skipped detail only its own slide
  function skipSlide() {
    settle();
    const slide = slides[i], x = openDetail(), target = x || slide, what = x ? 'detail' : 'slide';
    const op = { kind: 'skip', on: !skips(target), ...x && { id: idOf(x) } };
    remember({ slide, tree: twin(slide), what: `${op.on ? 'Skipped' : 'Unskipped'} ${what}`, detail: x ? nameOf(x) : headingOf(slide) && `"${headingOf(slide)}"`, op });
    perform(slide, op);
    renumber();
    if (x) sendThumb(i);
    else slides.forEach((s, n) => sendThumb(n));
    afterChange();
  }
  // after a change the view stays where it was, the open detail included, unless told where to go
  function afterChange(showing = slides[i], id = openDetail() ? idOf(openDetail()) : 0) {
    const sel = ed.sel;
    relocate();
    saveSuggestions();
    showSlide(showing, id);
    select(sel?.isConnected ? sel : null);
    ed.undo.disabled = !ed.done.length;
  }
  function undoChange() {
    settle();
    const last = ed.done.pop();
    if (!last) return;
    // an edit not saved yet is as if it never happened; taking back a saved one is an edit in itself
    const index = ed.unsaved.indexOf(last);
    if (index < 0) {
      const state = last.order ? { order: [...slides] } : { tree: twin(last.slide) };
      ed.unsaved.push({ slide: last.slide, ...state, what: 'Undid: ' + last.what, detail: last.detail, undone: last });
    } else ed.unsaved.splice(index, 1);
    if (last.order) arrange(last.order);
    else putBack(last.slide, twin(last.tree));
    afterChange(last.slide, last.det);
  }
  // a text or notes edit stores the whole new content, so it depends on an earlier edit of the same text or notes
  const holds = (later, earlier) => (later.op.kind === 'text' || later.op.kind === 'notes') &&
    later.op.kind === earlier.op?.kind && later.op.id === earlier.op.id;
  // What removing edit c leaves: the slide, or the slide order, as it was before c, with the later edits replayed on it.
  // gone has c and the later edits that can't be replayed without it, kept the others with their new snapshots. Undos of
  // saved edits always go, as they only work in order, and so do the edits on a slide whose adding goes
  function without(c) {
    const later = ed.unsaved.slice(ed.unsaved.indexOf(c) + 1), gone = [c], kept = [];
    if (c.order) {
      let order = c.order;
      later.forEach(x => {
        const next = x.order && !x.undone && place(order, x.op);
        if (gone.some(g => g.op?.added && g.slide === x.slide) || (x.order && !next)) gone.push(x);
        else if (next) {
          kept.push({ record: x, was: { order } });
          order = next;
        }
      });
      return { order, gone, kept };
    }
    const root = twin(c.tree);
    later.filter(x => x.slide === c.slide && !x.order).forEach(x => {
      const tree = twin(root);
      if (x.undone || gone.some(g => holds(x, g)) || !perform(root, x.op)) gone.push(x);
      else kept.push({ record: x, was: { tree } });
    });
    return { root, gone, kept };
  }
  // an Undid row goes back to before that undo, so what it undid can be undone again
  function removeEdit(c) {
    const { root, order, gone, kept } = without(c);
    for (const x of gone.reverse()) {
      ed.unsaved.splice(ed.unsaved.indexOf(x), 1);
      if (x.undone) {
        // back in its place: before the edits made since, on any slide
        const since = ed.done.findIndex(d => d.seq > x.undone.seq);
        ed.done.splice(since < 0 ? ed.done.length : since, 0, x.undone);
      } else ed.done.splice(ed.done.indexOf(x), 1);
    }
    kept.forEach(k => Object.assign(k.record, k.was));
    if (order) arrange(order);
    else putBack(c.slide, root);
    afterChange(c.slide, c.det);
  }
  // A thumbnail loaded the file as it was saved, so it is sent its slide's current HTML. Under it, a sub-thumbnail for each
  // of the slide's details shows the slide with that detail open
  function sendThumb(n) {
    const t = ed.thumbs[n];
    if (!t) return;
    sendView(t.querySelector('iframe'), slides[n].outerHTML);
    const subs = t.querySelector('.e-subs'), count = details(slides[n]).length;
    while (subs.children.length > count) subs.lastChild.remove();
    while (subs.children.length < count) {
      const k = subs.children.length, sub = document.createElement('div');
      sub.className = 'e-sub';
      sub.innerHTML = `<span class="e-sub-frame"><iframe tabindex="-1" loading="lazy" title="Slide ${n + 1}, detail ${k + 1}"></iframe></span>` +
        `<span class="e-thumb-skip">${icon('skip', 24)}</span>` + tool('e-thumb-del', 'Delete detail', 'close', 12);
      sub.lastChild.addEventListener('click', e => {
        e.stopPropagation();
        deleteDetail(slides[n], k);
      });
      const f = sub.querySelector('iframe');
      f.addEventListener('load', () => { sub.loaded = true; sendView(f, slides[n].outerHTML, k); });
      f.src = here + '?view';
      subs.append(sub);
      // sub-thumbnails above the current slide push it down: it stays in view
      if (n < i) ed.thumbs[i]?.scrollIntoView({ block: 'nearest' });
    }
    // one still loading gets the slide when it has loaded
    [...subs.children].forEach((sub, k) => { if (sub.loaded) sendView(sub.querySelector('iframe'), slides[n].outerHTML, k); });
  }
  const sendView = (f, html, d = -1) => f.contentWindow.postMessage({ deck: 'view', i: 0, k: -1, d, html, lang: cur }, '*');
  function textNodes(el) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), t = [];
    while (w.nextNode()) t.push(w.currentNode);
    return t;
  }
  function typeInto(el, x, y) {
    const before = twin(slideOf(el)), tree = twin(el), was = nameOf(el);
    select(el);
    // as it reads on the slide: while typing, every space and line break in the source would show
    textNodes(el).forEach(n => { n.data = n.data.replace(/[ \t\r\n\f]+/g, ' '); });
    if (el.firstChild?.nodeType === Node.TEXT_NODE) el.firstChild.data = el.firstChild.data.trimStart();
    if (el.lastChild?.nodeType === Node.TEXT_NODE) el.lastChild.data = el.lastChild.data.trimEnd();
    ed.typing = { el, before, tree, was, clean: el.innerHTML };
    // out of the way of the caret, and of what the marks would catch
    ed.layer.hidden = true;
    el.contentEditable = 'plaintext-only';
    el.focus();
    const point = document.caretRangeFromPoint?.(x, y), caret = getSelection();
    if (point && el.contains(point.startContainer)) caret.collapse(point.startContainer, point.startOffset);
    else {
      caret.selectAllChildren(el);
      caret.collapseToEnd();
    }
  }
  // stop typing, and keep it unless told otherwise. Nothing changed puts the source back as it was
  function commitText(cancel) {
    const t = ed.typing;
    if (!t) return;
    ed.typing = null;
    const { el, before } = t, slide = slideOf(el);
    el.blur();
    el.removeAttribute('contenteditable');
    getSelection().removeAllRanges();
    ed.layer.hidden = false;
    slide.scrollLeft = slide.scrollTop = 0;  // typing past the edge of the slide scrolled it
    // Shift+Enter typed a line break that only shows while typing
    textNodes(el).filter(n => n.data.includes('\n')).forEach(n =>
      n.replaceWith(...n.data.split('\n').flatMap((part, k) => k ? [document.createElement('br'), part] : [part])));
    el.normalize();
    while (el.lastChild?.localName === 'br' || isSpace(el.lastChild)) el.lastChild.remove();
    if (cancel || el.innerHTML === t.clean) {
      el.replaceChildren(...twin(t.tree).childNodes);
      select(el);
      return;
    }
    const id = elementIds.get(el);
    if (!el.textContent.trim() && !el.querySelector('img, svg')) {
      drop(el);
      change(slide, before, { what: 'Deleted', detail: t.was, op: { kind: 'delete', id } });
    } else change(slide, before, { what: 'Changed text', detail: `${t.was} → ${nameOf(el)}`, shows: id, op: { kind: 'text', id, tree: twin(el) } });
  }
  function settle() {
    commitText();
    notes.blur();
  }
  // the deck as its file says it: this document without what the engine added to it, and laid out as the template is.
  // The parser moves or drops the white space around <head> and </body>. `change` alters the copy before it is written
  function serialize(change) {
    const copy = document.documentElement.cloneNode(true);
    change?.(copy);
    copy.querySelectorAll('#notes, #deck-controls, #edit-bar, #edit-rail, #edit-status, #edit, #edit-ask, #edit-layer, #edit-layouts, #edit-copy, #edit-css, .slide > .counter:last-child, .detail > .detail-close:last-child, .detail-page').forEach(n => n.remove());
    copy.querySelectorAll('.slide.current').forEach(s => s.classList.remove('current'));
    copy.querySelectorAll('.detail.open').forEach(x => x.classList.remove('open'));
    copy.querySelectorAll('[data-detail][aria-expanded]').forEach(o => o.removeAttribute('aria-expanded'));
    copy.querySelectorAll('[data-lang-off], [data-lang-missing]').forEach(x => { x.removeAttribute('data-lang-off'); x.removeAttribute('data-lang-missing'); });
    copy.querySelectorAll('[data-set-lang][aria-pressed]').forEach(b => b.removeAttribute('aria-pressed'));
    if (langs.length > 1) {
      ownLang === null ? copy.removeAttribute('lang') : copy.setAttribute('lang', ownLang);
      const t = copy.querySelector('title');
      if (t) t.textContent = ownTitle;
    }
    copy.querySelectorAll('.build.on').forEach(b => b.classList.remove('on'));
    copy.classList.remove('editing');
    ['--scale', '--edit-rail', '--edit-pane', '--edit-x', '--edit-y'].forEach(p => copy.style.removeProperty(p));
    ['class', 'style'].forEach(a => { if (!copy.getAttribute(a)) copy.removeAttribute(a); });
    const html = copy.outerHTML.replace(/^(<html[^>]*>)<head>/, '$1\n<head>').replace(/\s*<\/body><\/html>\s*$/, '\n</body>\n</html>');
    return [...document.childNodes].map(n => n === document.documentElement ? html
      : n.nodeType === Node.DOCUMENT_TYPE_NODE ? '<!doctype html>' : new XMLSerializer().serializeToString(n)).join('\n') + '\n';
  }
  function download(html, name) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([html], { type: 'text/html' })), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  // The file dialogs of the browser, where it has them. A save asks with the one that opens a file: the deck is
  // pointed at, and no new file can be made there by accident. A copy asks with the one that saves under a new name
  const HTML = { id: 'deckfile', types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }] };
  const askFile = async () => (await showOpenFilePicker(HTML))[0];
  const askCopy = name => showSaveFilePicker({ ...HTML, suggestedName: name });
  async function write(file, html) {
    const out = await file.createWritable();
    await out.write(html);
    await out.close();
  }
  const deckName = () => decodeURIComponent(location.pathname).split('/').pop() || 'index.html';
  const copyName = pub => deckName().replace(/(\.html?)?$/i, (pub ? '-public' : '-copy') + '$1');
  // Whether a file kept from an earlier visit still is the one this page was opened from. A page cannot reach that
  // file or know its folder, so this goes by what it can see: a file that may be written, with the name of the deck,
  // last changed when the page was loaded
  async function ours(file) {
    try {
      return file.name === deckName() && await file.requestPermission({ mode: 'readwrite' }) === 'granted' &&
        Math.abs((await file.getFile()).lastModified - Date.parse(document.lastModified)) < 1000;
    } catch { return false; }
  }
  // the file a save writes to, kept across visits under the path of the deck: kept(file) stores it, kept(null) forgets
  // it, kept() gives it back. A browser that cannot keep it asks for the file on every visit
  function kept(file) {
    return new Promise(done => {
      try {
        const open = indexedDB.open('deckfile', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('files');
        open.onerror = () => done();
        open.onsuccess = () => {
          try {
            const files = open.result.transaction('files', 'readwrite').objectStore('files');
            const req = file === undefined ? files.get(location.pathname) : files.put(file, location.pathname);
            req.onsuccess = () => done(file === undefined ? req.result : undefined);
            req.onerror = () => done();
          } catch { done(); }
        };
      } catch { done(); }
    });
  }
  // the box under Save: its menu, or which file to choose before the file dialog opens
  function showBox(html) {
    ed.copyBox.hidden = !html;
    ed.save.setAttribute('aria-expanded', !!html);
    ed.copyBox.innerHTML = html || '';
    ed.asking = false;
    if (!html) return;
    const r = ed.save.getBoundingClientRect();
    ed.copyBox.style.top = r.bottom + 4 + 'px';
    ed.copyBox.style.right = innerWidth - r.right + 'px';
  }
  const option = (cls, name, title, text) => `<button type="button" class="${cls}">${icon(name)}<span><b>${title}</b><small>${text}</small></span></button>`;
  // Save's menu: the deck to its file, a whole copy, or a copy to hand out with what that leaves out
  function showCopy() {
    const n = slides.length - shown().length, d = shown().reduce((sum, s) => sum + details(s).filter(skips).length, 0);
    const left = [n && `the ${n} skipped slide${n > 1 ? 's' : ''}`, d && `the ${d} skipped detail${d > 1 ? 's' : ''}`].filter(Boolean).join(' and ');
    showBox(option('e-save-go', 'save', 'Save', 'Writes the deck to its file, with your changes. Cmd/Ctrl+S') +
      option('e-copy-full', 'copy', 'Save a copy…', 'The whole deck as it is now, under a new name. This deck stays the one you edit.') +
      option('e-copy-go', 'saveAs', 'Save public copy…', 'A copy to send to your audience, without the speaker notes, ' +
        (left || 'any skipped slides') + ', the comments between the slides and the edit view.'));
  }
  // under Save, before the file dialog: which file to choose there, and why; `wrong` is the name of one that was not it
  function showFile(wrong) {
    const name = `<b>${esc(deckName())}</b>`;
    showBox(option('e-file-go', 'save', 'Choose the file', wrong === undefined
      ? `Save writes to the file of this deck. The browser has to be shown where it is, once: choose ${name} in the dialog that opens.`
      : `That was <b>${esc(wrong)}</b>, which is left as it was. Save writes to the file of this deck: choose ${name}.`));
    ed.asking = true;
  }
  // what the public copy leaves out: the speaker notes, the skipped slides, the layouts and the comments between the
  // slides. It is marked so that it opens without the edit view, and an engine inlined in it loses the code of that
  // view, most of its size
  function trim(copy) {
    const all = copy.querySelector('#stage'), w = document.createTreeWalker(all, NodeFilter.SHOW_COMMENT), out = [];
    while (w.nextNode()) out.push(w.currentNode);
    [...out, ...copy.querySelectorAll('.s-notes, .slide[data-skip], .detail[data-skip], template[data-deck="layouts"]')].forEach(drop);
    all.querySelectorAll('[data-detail]').forEach(o => { if (!all.querySelector(`.detail[id="${CSS.escape(o.dataset.detail)}"]`)) o.removeAttribute('data-detail'); });
    all.setAttribute('data-public', '');
    const engine = copy.querySelector('script[data-deck="engine"]');
    if (engine) engine.textContent = engine.textContent.replace(/\n *\/\/ -+ the edit view[\s\S]*\/\/ -+ end of the edit view[^\n]*/, '');
  }
  // A copy of the deck as it is now, under a name of its own: whole, or trimmed to hand out. It goes to a file chosen
  // in a dialog where the browser has one, else it downloads. This deck stays the one that is edited and saved
  async function saveAs(pub) {
    settle();
    showBox();
    const html = serialize(pub ? trim : undefined), name = copyName(pub);
    let label = 'Saved a copy';
    try {
      if (window.showSaveFilePicker) await write(await askCopy(name), html);
      else {
        download(html, name);
        label = 'Downloaded';
      }
    } catch (e) {
      if (e.name === 'AbortError') return;  // the file dialog was cancelled
      label = 'Save failed';
    }
    saved(label);
  }
  // Write the deck: to its file where the browser can, else as a download. The first save says which file to choose
  // and asks for it, later saves and visits write to it without asking. A file under another name is not the deck,
  // and is left alone. `go` is the press in the box under Save, or a second Cmd/Ctrl+S: the dialog opens
  async function saveDeck(go) {
    settle();
    go ||= ed.asking;
    showBox();
    const html = serialize(), name = deckName();
    let label = 'Saved';
    try {
      if (window.showOpenFilePicker) {
        if (!ed.file) {
          let file = go ? await askFile() : await kept();
          if (!go && (!file || !await ours(file))) {
            // forgotten, so that a file that is refused or gone is not asked for again
            if (file) kept(null);
            return showFile();
          }
          if (file.name !== name) return showFile(file.name);
          ed.file = file;
        }
        await write(ed.file, html);
        kept(ed.file);
      } else {
        download(html, name);
        label = 'Downloaded';
      }
      ed.unsaved = [];
      drawUnsaved();
    } catch (e) {
      if (e.name === 'AbortError') return;  // the file dialog was cancelled
      // a browser may want a press of its own before it lets the page write to a file just chosen: the file stays
      if (go && ed.file && e.name === 'NotAllowedError') label = 'Save again';
      else {
        ed.file = null;
        kept(null);
        label = 'Save failed';
      }
    }
    saved(label);
  }
  // what a save did, on the Save button for a moment
  function saved(label) {
    const text = ed.save.querySelector('span');
    text.textContent = label;
    setTimeout(() => { text.textContent = 'Save'; }, 2000);
  }
  // the clipboard API, or the older execCommand where a browser refuses it
  function copyText(text) {
    const old = () => {
      const t = document.createElement('textarea');
      t.value = text;
      t.style.cssText = 'position:fixed;opacity:0';
      document.body.append(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    };
    return navigator.clipboard ? navigator.clipboard.writeText(text).then(() => true, old) : Promise.resolve(old());
  }
  // ---- end of the edit view ----

  // a refresh stays in the edit view; here at the end, because that view uses everything above
  if (canEdit && store.get(EDIT_KEY)) edit(true);
})();
