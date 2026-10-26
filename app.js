// Notary Page Sorter: splits a PDF into a Letter PDF and a Legal PDF, right in the browser.
// Nothing is uploaded. The page's security rule (see index.html) blocks all network requests.
(function () {
  'use strict';

  const $ =(id) => document.getElementById(id);

  const drop = $('drop');
  const fileInput = $('file');
  const chooseButton = $('choose');
  const sampleButton = $('sample');
  const unlockForm = $('unlock');
  const unlockLabel = $('unlock-label');
  const passwordInput = $('password');
  const statusLine = $('status');
  const results = $('results');

  // Paper sizes in points (72 points = 1 inch).
  const PAPER = {
    letter: { short: 612, long: 792 },
    legal: { short: 612, long: 1008 }
  };
  const CLOSE_ENOUGH = 18; // a quarter inch
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let downloadUrls = [];
  let waitingForPassword = null;

  // ---------- Picking a file ----------

  chooseButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (file) openFile(file);
  });

  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    drop.classList.add('over');
  });
  window.addEventListener('dragleave', (event) => {
    if (!event.relatedTarget) drop.classList.remove('over');
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    drop.classList.remove('over');
    const file = event.dataTransfer.files[0];
    if (file) openFile(file);
  });

  sampleButton.addEventListener('click', async () => {
    setBusy(true, 'Making a sample loan package...');
    try {
      const bytes = await window.buildSamplePackage();
      await sortPdf(bytes, 'sample-loan-package.pdf', { sample: true });
    } catch (error) {
      console.error(error);
      showError('The sample could not be made. Refresh the page and try again.');
      setBusy(false);
    }
  });

  unlockForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!waitingForPassword) return;
    const { bytes, name, options } = waitingForPassword;
    const password = passwordInput.value;
    passwordInput.value = '';
    unlockForm.hidden = true;
    sortPdf(bytes, name, { ...options, password });
  });

  $('reset').addEventListener('click', () => {
    clearResults();
    drop.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    chooseButton.focus({ preventScroll: true });
  });

  $('print-guide').addEventListener('click', () => window.print());

  async function openFile(file) {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      clearResults();
      showError(`"${file.name}" is not a PDF. Pick a file that ends in .pdf.`);
      return;
    }
    setBusy(true, 'Reading your PDF...');
    const bytes = new Uint8Array(await file.arrayBuffer());
    await sortPdf(bytes, file.name, {});
  }

  // ---------- Sorting ----------

  async function sortPdf(bytes, name, options) {
    clearResults();
    setBusy(true, 'Reading your PDF...');
    try {
      if (!window.PDFLib) throw new Error('The PDF tools did not load. Check that the vendor folder is next to index.html.');
      const source = await openPdf(bytes, name, options);
      if (!source) return;

      const pages = measure(source);
      if (!pages.length) {
        showError('This PDF has no pages to sort.');
        return;
      }
      setStatus(`Sorting ${pages.length} pages...`);
      await nextPaint();

      const letter = pages.filter((p) => p.size === 'letter');
      const legal = pages.filter((p) => p.size === 'legal');
      const letterBytes = await buildPile(source, letter, name, 'Letter');
      const legalBytes = await buildPile(source, legal, name, 'Legal');

      showResults({ name, pages, letter, legal, letterBytes, legalBytes, sampleBytes: options.sample ? bytes : null });
      setStatus('');
    } catch (error) {
      console.error(error);
      showError(error.friendly || 'Something went wrong while sorting. Try opening the PDF, choose Print, then Save as PDF, and drop in the new copy.');
    } finally {
      setBusy(false);
    }
  }

  async function openPdf(bytes, name, options) {
    const { PDFDocument } = window.PDFLib;
    let doc;
    try {
      doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    } catch (error) {
      throw friendly("This file could not be opened as a PDF. It may be damaged. Open it, choose Print, then Save as PDF, and drop in the new copy.", error);
    }
    if (!doc.isEncrypted) return doc;

    // Most locked loan packages open with an empty password. Try that first.
    try {
      return await PDFDocument.load(bytes, { password: options.password ?? '', updateMetadata: false });
    } catch (error) {
      waitingForPassword = { bytes, name, options };
      unlockLabel.textContent = options.password === undefined
        ? 'This PDF is locked. Type its password to sort it.'
        : 'That password did not work. Check it and try again.';
      unlockForm.hidden = false;
      setStatus('');
      passwordInput.focus();
      return null;
    }
  }

  function measure(doc) {
    return doc.getPages().map((page, index) => {
      const box = page.getCropBox();
      return { index, number: index + 1, ...classify(box.width, box.height) };
    });
  }

  // Pick the closer paper size. Pages more than a quarter inch off both sizes get flagged.
  function classify(width, height) {
    const long = Math.max(width, height);
    const short = Math.min(width, height);
    const off = (paper) => Math.abs(long - paper.long) + Math.abs(short - paper.short);
    const size = off(PAPER.legal) < off(PAPER.letter) ? 'legal' : 'letter';
    const odd = off(PAPER[size]) > CLOSE_ENOUGH;
    const inches = `${(short / 72).toFixed(1)} x ${(long / 72).toFixed(1)} in`;
    return { size, odd, inches, ratio: long / short };
  }

  async function buildPile(source, pages, name, label) {
    if (!pages.length) return null;
    const { PDFDocument } = window.PDFLib;
    const pile = await PDFDocument.create();
    const copies = await pile.copyPages(source, pages.map((p) => p.index));
    copies.forEach((page) => pile.addPage(page));
    pile.setTitle(`${baseName(name)} (${label} pages)`);
    pile.setCreator('Notary Page Sorter');
    pile.setProducer('Notary Page Sorter');
    return pile.save();
  }

  // ---------- Showing the result ----------

  function showResults({ name, pages, letter, legal, letterBytes, legalBytes, sampleBytes }) {
    const both = letter.length > 0 && legal.length > 0;
    const title = $('result-title');
    if (both) title.textContent = `Sorted. ${letter.length} Letter, ${legal.length} Legal.`;
    else if (legal.length === 0) title.textContent = 'Every page is Letter, so there is nothing to sort.';
    else title.textContent = 'Every page is Legal, so there is nothing to sort.';
    $('result-file').textContent = `${name}, ${plural(pages.length, 'page')}`;
    $('print-file').textContent = `Restack guide for ${name} (${plural(pages.length, 'page')})`;

    // Page map
    const map = $('map');
    const step = Math.min(30, 1400 / pages.length);
    map.replaceChildren(...pages.map((p, i) => {
      const tile = document.createElement('li');
      tile.className = `tile ${p.size}${p.odd ? ' odd' : ''}`;
      tile.textContent = p.number;
      const label = `Page ${p.number}: ${p.size === 'legal' ? 'Legal' : 'Letter'}${p.odd ? `, actually ${p.inches}, check it` : ''}`;
      tile.title = label;
      tile.setAttribute('aria-label', label);
      if (p.odd) tile.style.height = `${Math.round(30 * Math.min(Math.max(p.ratio, 1), 2))}px`;
      tile.style.setProperty('--t', `${Math.round(i * step)}ms`);
      return tile;
    }));
    const duration = reduceMotion ? 0 : Math.round(pages.length * step + 240);

    const odd = pages.filter((p) => p.odd);
    $('key-odd').hidden = odd.length === 0;
    $('odd-note').hidden = odd.length === 0;
    if (odd.length) {
      const list = odd.slice(0, 12).map((p) => `${p.number} (${p.inches})`).join(', ');
      const more = odd.length > 12 ? `, and ${odd.length - 12} more` : '';
      $('odd-note').textContent = odd.length === 1
        ? `Page ${list} is not exactly Letter or Legal. It went in the closest pile. Check it before you print.`
        : `Pages ${list}${more} are not exactly Letter or Legal. They went in the closest pile. Check them before you print.`;
    }

    // Piles
    fillPile('letter', letter, letterBytes, name, duration);
    fillPile('legal', legal, legalBytes, name, duration);

    // Print plan
    const steps = [];
    if (both) {
      steps.push(['Load ', strong('Letter'), ` paper. Print the Letter PDF (${plural(letter.length, 'page')}).`]);
      steps.push(['Load ', strong('Legal'), ` paper. Print the Legal PDF (${plural(legal.length, 'page')}).`]);
      steps.push(['Put the pages back in order with the restack guide below.']);
    } else {
      const only = letter.length ? 'Letter' : 'Legal';
      steps.push(['Load ', strong(only), ' paper.']);
      steps.push([`Print the ${only} PDF or your original file. Every page is already in order.`]);
    }
    $('steps').replaceChildren(...steps.map((parts) => element('li', parts)));

    $('restack-block').hidden = !both;
    if (both) {
      $('restack').replaceChildren(...runsOf(pages).map((run) => {
        const isLegal = run.size === 'legal';
        const item = element('li', [
          element('span', [isLegal ? 'Legal' : 'Letter'], `chip ${run.size}`),
          element('span', ['Take ', strong(String(run.count)), ` ${run.count === 1 ? 'sheet' : 'sheets'}`]),
          element('span', [run.count === 1 ? `page ${run.from}` : `pages ${run.from} to ${run.to}`], 'pages')
        ], run.size);
        return item;
      }));
    }

    const sampleLink = $('sample-dl');
    sampleLink.hidden = !sampleBytes;
    if (sampleBytes) sampleLink.href = blobUrl(sampleBytes);

    results.hidden = false;
    title.focus({ preventScroll: true });
    results.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function fillPile(kind, pages, bytes, name, duration) {
    const count = $(`${kind}-count`);
    const link = $(`${kind}-dl`);
    $(`${kind}-word`).textContent = pages.length === 1 ? 'page' : 'pages';
    $(`${kind}-empty`).hidden = pages.length > 0;
    // The little stack shows up to three sheets.
    document.querySelectorAll(`.pile-art.${kind} span`).forEach((sheet, i) => { sheet.hidden = i >= pages.length; });
    link.hidden = !bytes;
    if (bytes) {
      link.href = blobUrl(bytes);
      link.download = `${baseName(name)} - ${kind.toUpperCase()}.pdf`;
    }
    countUp(count, pages.length, duration);
  }

  // Group pages in order into runs of the same size: "take 4 Letter, then 1 Legal..."
  function runsOf(pages) {
    const runs = [];
    for (const page of pages) {
      const last = runs[runs.length - 1];
      if (last && last.size === page.size) {
        last.to = page.number;
        last.count++;
      } else {
        runs.push({ size: page.size, from: page.number, to: page.number, count: 1 });
      }
    }
    return runs;
  }

  function countUp(el, target, duration) {
    if (!duration || target === 0) {
      el.textContent = target;
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      el.textContent = Math.round(target * progress);
      if (progress < 1) requestAnimationFrame(tick);
    };
    el.textContent = '0';
    requestAnimationFrame(tick);
  }

  // ---------- Small helpers ----------

  function clearResults() {
    results.hidden = true;
    unlockForm.hidden = true;
    waitingForPassword = null;
    downloadUrls.forEach((url) => URL.revokeObjectURL(url));
    downloadUrls = [];
    setStatus('');
  }

  function setBusy(busy, message) {
    drop.classList.toggle('busy', busy);
    chooseButton.disabled = busy;
    sampleButton.disabled = busy;
    if (message) setStatus(message);
  }

  function setStatus(message) {
    statusLine.classList.remove('error');
    statusLine.textContent = message;
  }

  function showError(message) {
    statusLine.classList.add('error');
    statusLine.textContent = message;
  }

  function friendly(message, cause) {
    const error = new Error(message, { cause });
    error.friendly = message;
    return error;
  }

  function blobUrl(bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    downloadUrls.push(url);
    return url;
  }

  function baseName(name) {
    return name.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'document';
  }

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  function strong(text) {
    return element('strong', [text]);
  }

  function element(tag, children, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.append(...children);
    return el;
  }

  function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }
})();
