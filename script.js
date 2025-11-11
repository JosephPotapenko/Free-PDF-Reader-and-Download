/*
  Document Reader + TTS
  - Uses SpeechSynthesis for playback.
  - Uses PDF.js to extract and render PDFs.
  - Double-click jump implemented by mapping double-click location to character index where possible.
*/

/* ---------- Utilities ---------- */
const $ = id => document.getElementById(id);

function readFileAsText(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.onerror = rej;
    reader.readAsText(file);
  });
}

/* ---------- PDF handling via pdf.js ---------- */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data:arrayBuffer}).promise;
  let fullText = '';
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const pageText = tc.items.map(i => i.str).join(' ');
    pages.push({page, textItems: tc.items, text: pageText});
    fullText += pageText + '\n\n';
  }
  return {text:fullText, pages};
}

/* ---------- UI state ---------- */
let currentText = '';
let currentChunks = []; // for chunked reading
let currentIndex = 0;
let isPlaying = false;
let utterance = null;
let currentVoice = null;
let voices = [];

/* ---------- DOM references ---------- */
const fileInput = $('fileInput');
const pdfViewer = $('pdfViewer');
const pasteBox = $('pasteBox');
const voiceSelect = $('voiceSelect');
const playPauseBtn = $('playPauseBtn');
const stopBtn = $('stopBtn');
const rateSlider = $('rateSlider');
const speedLabel = $('speedLabel');
const volumeSlider = $('volumeSlider');
const moreVoicesBtn = $('moreVoicesBtn');
const moreVoicesModal = $('moreVoicesModal');
const closeMoreVoices = $('closeMoreVoices');
const closeMoreVoicesFooter = $('closeMoreVoicesFooter');
const refreshVoicesBtn = $('refreshVoicesBtn');
const darkModeToggle = $('darkModeToggle');
// Removed chunkSizeInput from UI; using an internal chunk size instead
let internalChunkSize = 3000; // adjustable logic; large enough for smooth playback
const fileList = $('fileList');
// downloadBtn and recStatus removed from UI
const voiceInfo = $('voiceInfo');

/* ---------- Populate voices ---------- */
function populateVoiceList() {
  voices = speechSynthesis.getVoices();
  voiceSelect.innerHTML = '';

  // Try to pick the 5 voices requested (heuristic)
  // priority: en-US male, en-US female, en-GB male, en-GB female, another female/other
  const picks = [];
  const find = (pred) => voices.find(pred);

  const isMaleName = (name) => /\b(John|David|Mark|Tom|Alex|Peter|Paul|Daniel|Michael|James|William)\b/i.test(name);
  const isFemaleName = (name) => /\b(Emily|Emma|Olivia|Sophia|Ava|Isabella|Elizabeth|Anna|Sarah|Mia)\b/i.test(name);

  // heuristics
  picks.push(find(v => /en[-_]?us/i.test(v.lang) && isMaleName(v.name)));
  picks.push(find(v => /en[-_]?us/i.test(v.lang) && isFemaleName(v.name)));
  picks.push(find(v => /en[-_]?gb/i.test(v.lang) && isMaleName(v.name)));
  picks.push(find(v => /en[-_]?gb/i.test(v.lang) && isFemaleName(v.name)));
  // fallback picks
  picks.push(find(v => /en/i.test(v.lang) && !picks.includes(v)));
  // fill up to 5 unique
  const unique = [];
  for (const p of picks) if (p && !unique.includes(p)) unique.push(p);
  for (const v of voices) if (unique.length < 5 && !unique.includes(v)) unique.push(v);

  // If still empty (rare), list whatever voices exist
  const listToShow = unique.length ? unique : voices.slice(0,5);

  // populate select with those options (and include rest)
  listToShow.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} — ${v.lang} ${v.default ? '(default)' : ''}`;
    voiceSelect.appendChild(opt);
  });

  // also include a divider and all voices in case user wants others
  const divider = document.createElement('option');
  divider.disabled = true;
  divider.textContent = '──────── All installed voices ────────';
  voiceSelect.appendChild(divider);
  voices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} — ${v.lang} ${v.default ? '(default)' : ''}`;
    voiceSelect.appendChild(opt);
  });

  updateVoiceInfo();
}

function updateVoiceInfo() {
  const suggested = Array.from(voiceSelect.options).slice(0,5).map(o => o.textContent).join('<br>');
  voiceInfo.innerHTML = `Top suggestions (based on available voices):<br>${suggested}<br><br>Browser-provided voices vary by OS/browser. If you need specific commercial voices (e.g., a particular British male), consider using a cloud TTS provider and their API (requires server/API key).`;
}

/* ---------- Text handling ---------- */
let isPDFMode = false; // controls whether pdfViewer stays visible
let pdfSpans = []; // flattened list of {start, end, el}
let currentPDFSpanEl = null;
let lastBoundaryGlobalStart = 0; // last known global char index where playback boundary occurred
let settingsRestartTimer = null; // debounce timer for settings changes
let restartInFlight = false; // prevent races when restarting

function setTextViewer(text) {
  currentText = text || '';
  // Keep textarea as the primary text view
  pasteBox.value = currentText;
  // If not in PDF mode, hide the PDF viewer; otherwise leave it visible above the textbox
  if (!isPDFMode) {
    pdfViewer.style.display = 'none';
  }
  // reset
  currentIndex = 0;
  buildChunks();
}

function buildChunks() {
  const chunkSize = internalChunkSize;
  currentChunks = [];
  for (let i=0;i<currentText.length;i+=chunkSize) {
    currentChunks.push(currentText.slice(i, i+chunkSize));
  }
}

// Try to jump to a character index (start playback there)
function jumpToCharIndex(idx) {
  if (!currentText) return;
  // clamp
  idx = Math.max(0, Math.min(currentText.length-1, idx));
  // find chunk index
  const chunkSize = internalChunkSize;
  currentIndex = Math.floor(idx / chunkSize);
  // visually scroll textarea to approximate position
  const ratio = idx / Math.max(1, currentText.length);
  pasteBox.scrollTop = (pasteBox.scrollHeight - pasteBox.clientHeight) * ratio;
  // start reading from exact position inside the chunk
  const baseOffset = currentIndex * chunkSize;
  const offsetWithinChunk = Math.max(0, idx - baseOffset);
  playFromCurrentChunk(offsetWithinChunk);
}

/* ---------- Double-click handling for jump (textarea) ---------- */
pasteBox.addEventListener('dblclick', () => {
  // Use caret position as the character index
  const idx = pasteBox.selectionStart || 0;
  jumpToCharIndex(idx);
});

// For rendered PDF pages (text-layer spans), detect dblclick inside pdfViewer
pdfViewer.addEventListener('dblclick', (ev) => {
  // if clicked on a span with data-char-index attribute, jump
  let t = ev.target;
  while (t && t !== pdfViewer) {
    if (t.dataset && t.dataset.charIndex) {
      try {
        const data = JSON.parse(t.dataset.charIndex);
        let total = 0;
        for (const p of pdfPagesMeta) {
          if (p.pageNum < data.page) total += p.text.length + 2; // account for added newlines
        }
        const charIdx = total + (data.offset || 0);
        jumpToCharIndex(charIdx);
        return;
      } catch (e) {
        // ignore and fallback
      }
    }
    t = t.parentElement;
  }
  // fallback: proportional map
  const rect = pdfViewer.getBoundingClientRect();
  const ratio = (ev.clientY - rect.top) / rect.height;
  const charIdx = Math.floor(currentText.length * ratio);
  jumpToCharIndex(charIdx);
});
 
/* ---------- PDF render and simple text-layer mapping ---------- */
let pdfPagesMeta = []; // {pageNum, text, items}
async function renderPDFToViewer(file) {
  pdfViewer.innerHTML = '';
  pdfViewer.style.display = 'block';
  isPDFMode = true;
  const data = await extractTextFromPDF(file);
  pdfPagesMeta = [];
  pdfSpans = [];
  let accumulated = '';
  for (let i=0;i<data.pages.length;i++) {
    const p = data.pages[i];
    const pageNum = i+1;
    const pageBase = accumulated.length; // global start index of this page in currentText
    const pageDiv = document.createElement('div');
    pageDiv.className = 'pdf-page';
    pageDiv.dataset.page = pageNum;
    // create a simple text layer: each text item becomes a span so dblclick can map roughly
    const textLayer = document.createElement('div');
    textLayer.style.lineHeight = '1.5';
    const items = p.textItems;
    let charAcc = 0;
    for (let j=0;j<items.length;j++) {
      const itm = items[j];
      const span = document.createElement('span');
      span.textContent = itm.str + (j < items.length-1 ? ' ' : '');
      // store page and char index in dataset
      span.dataset.charIndex = JSON.stringify({page:pageNum, offset:charAcc});
      // compute global start/end and record span for highlighting lookup
      const start = pageBase + charAcc;
      const end = start + span.textContent.length;
      pdfSpans.push({start, end, el: span});
      // increment
      charAcc += span.textContent.length;
      span.style.cursor = 'pointer';
      span.title = span.textContent.slice(0,60);
      textLayer.appendChild(span);
    }
    pageDiv.appendChild(document.createElement('h4')).appendChild(document.createTextNode(`Page ${pageNum}`));
    pageDiv.appendChild(textLayer);
    pdfViewer.appendChild(pageDiv);
    pdfPagesMeta.push({pageNum, text: p.text, items: items});
    accumulated += p.text + '\n\n';
  }

  // set overall text as accumulated text and allow reading; keep PDF visible
  currentText = accumulated;
  pasteBox.value = accumulated;
  currentIndex = 0;
  buildChunks();
}

function clearPDFHighlight(){
  if (currentPDFSpanEl){
    currentPDFSpanEl.classList.remove('pdf-reading');
    currentPDFSpanEl = null;
  }
}

function findPDFSpanAt(idx){
  // binary search in sorted pdfSpans
  let lo = 0, hi = pdfSpans.length - 1, ans = null;
  while (lo <= hi){
    const mid = (lo + hi) >> 1;
    const s = pdfSpans[mid];
    if (idx < s.start) hi = mid - 1;
    else if (idx >= s.end) lo = mid + 1;
    else { ans = s; break; }
  }
  return ans;
}

/* ---------- Playback (SpeechSynthesis) ---------- */
function speakChunk(text, onend, baseOffsetOverride) {
  if (utterance) {
    utterance.onend = null;
    utterance.onerror = null;
    speechSynthesis.cancel();
    utterance = null;
  }
  utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = Number(rateSlider.value) || 1;
  utterance.volume = Number(volumeSlider.value) || 1;
  // set voice
  const selName = voiceSelect.value;
  const v = voices.find(vo => vo.name === selName) || voices.find(vo => vo.default) || voices[0];
  if (v) utterance.voice = v;
  // Word boundary highlighting within textarea
  const baseOffset = (typeof baseOffsetOverride === 'number') ? baseOffsetOverride : (currentIndex * internalChunkSize);
  // initialize last boundary to start of this utterance as a fallback
  lastBoundaryGlobalStart = baseOffset;
  utterance.onboundary = (e) => {
    // Some browsers do not set name='word'; update on any boundary with indices
    if (e && (typeof e.charIndex === 'number')) {
      const start = baseOffset + (e.charIndex || 0);
      const end = start + (e.charLength || 1);
      lastBoundaryGlobalStart = start;
      // Apply selection to visualize current word
      try { pasteBox.setSelectionRange(start, end); } catch(_) {}
      // Keep current selection roughly centered
      const selEnd = end;
      const beforeText = pasteBox.value.slice(0, selEnd);
      const approxLines = beforeText.split(/\n/).length;
      const lineHeight = 20;
      const desiredScroll = (approxLines * lineHeight) - (pasteBox.clientHeight / 2);
      if (Math.abs(pasteBox.scrollTop - desiredScroll) > 60) {
        pasteBox.scrollTop = desiredScroll;
      }
      // If a PDF is visible, move an overlay highlight across spans
      if (isPDFMode && pdfSpans.length){
        const hit = findPDFSpanAt(start);
        if (hit && hit.el !== currentPDFSpanEl){
          clearPDFHighlight();
          currentPDFSpanEl = hit.el;
          currentPDFSpanEl.classList.add('pdf-reading');
          // keep highlighted word visible
          try { currentPDFSpanEl.scrollIntoView({block:'center'}); } catch(_) {}
        }
      }
    }
  };
  utterance.onend = () => {
    if (typeof onend === 'function') onend();
  };
  utterance.onerror = (e) => {
    console.error('TTS error', e);
    isPlaying = false;
  };
  speechSynthesis.speak(utterance);
}

function updatePlayPauseUI(){
  if (!playPauseBtn) return;
  if (isPlaying) {
    playPauseBtn.classList.add('is-playing');
    playPauseBtn.classList.remove('is-paused');
    playPauseBtn.innerHTML = '<i class="fa fa-pause"></i> Pause';
  } else {
    playPauseBtn.classList.remove('is-playing');
    playPauseBtn.classList.add('is-paused');
    playPauseBtn.innerHTML = '<i class="fa fa-play"></i> Play';
    // Clear any lingering selection highlight when not playing
    try {
      const end = pasteBox.selectionEnd || 0;
      pasteBox.setSelectionRange(end, end);
    } catch(e) {}
    clearPDFHighlight();
  }
}

function playFromCurrentChunk(offsetWithinChunk = 0){
  if (!currentChunks.length) buildChunks();
  if (currentIndex < 0) currentIndex = 0;
  if (currentIndex >= currentChunks.length) { isPlaying=false; return; }
  isPlaying = true;
  restartInFlight = false; // new utterance starting
  const chunkFull = currentChunks[currentIndex] || '';
  const speakOffset = Math.max(0, Math.min(offsetWithinChunk, chunkFull.length));
  const chunk = speakOffset ? chunkFull.slice(speakOffset) : chunkFull;
  const baseOffset = currentIndex * internalChunkSize + speakOffset;
  updatePlayPauseUI();
  speakChunk(chunk, () => {
    currentIndex++;
    if (currentIndex < currentChunks.length && isPlaying) {
      // small delay to allow UI updates
      setTimeout(()=> playFromCurrentChunk(), 120);
    } else {
      isPlaying = false;
      updatePlayPauseUI();
    }
  }, baseOffset);
}

if (playPauseBtn) {
  playPauseBtn.addEventListener('click', ()=> {
    if (!currentText) {
      alert('No text loaded. Upload or paste text first.');
      return;
    }
    if (!isPlaying) {
      if (speechSynthesis.paused) {
        speechSynthesis.resume();
        isPlaying = true;
        updatePlayPauseUI();
      } else {
        playFromCurrentChunk();
      }
    } else {
      if (speechSynthesis.speaking) speechSynthesis.pause();
      isPlaying = false;
      updatePlayPauseUI();
    }
  });
}

stopBtn.addEventListener('click', ()=> {
  speechSynthesis.cancel();
  isPlaying = false;
  currentIndex = 0;
  // Clear selection highlight
  try { pasteBox.setSelectionRange(0,0); } catch(e) {}
  clearPDFHighlight();
  updatePlayPauseUI();
});

/* ---------- Voice selection changes ---------- */
voiceSelect.addEventListener('change', () => {
  // Switch voice immediately mid-playback by restarting at last boundary
  restartWithNewSettingsFromCurrentPosition(true);
});

/* ---------- sliders ---------- */
rateSlider.addEventListener('change', ()=> {
  speedLabel.textContent = Number(rateSlider.value).toFixed(2) + '×';
  restartWithNewSettingsFromCurrentPosition(false);
});
rateSlider.addEventListener('input', ()=> {
  speedLabel.textContent = Number(rateSlider.value).toFixed(2) + '×';
});
volumeSlider.addEventListener('change', ()=> {
  restartWithNewSettingsFromCurrentPosition(false);
});

/* ---------- Load File(s) ---------- */
fileInput.addEventListener('change', async (ev) => {
  const files = Array.from(ev.target.files || []);
  if (!files.length) return;
  fileList.innerHTML = '';
  // update truncated filename display
  const fileNamesDiv = document.getElementById('fileNames');
  if (fileNamesDiv) {
    const names = files.map(f => f.name).join(', ');
    fileNamesDiv.textContent = names;
    fileNamesDiv.title = names;
  }
  for (const f of files) {
    const item = document.createElement('div');
    item.className = 'file-item';
    const left = document.createElement('div');
    left.innerHTML = `<strong>${f.name}</strong> <div class="small-muted">${(f.size/1024/1024).toFixed(2)} MB • ${f.type || 'unknown'}</div>`;
    item.appendChild(left);
    fileList.appendChild(item);
    // auto-load immediately
    if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
      try {
        await renderPDFToViewer(f);
      } catch (e) {
        console.error('PDF load failed', e);
        alert('Could not load PDF.');
      }
    } else {
      try {
        isPDFMode = false;
        const txt = await readFileAsText(f);
        setTextViewer(txt);
      } catch (e) {
        alert('Could not read file as text.');
      }
    }
  }
  // auto export after upload if enabled
  // auto export removed
});

/* ---------- Text area live binding ---------- */
pasteBox.addEventListener('input', ()=> {
  // keep currentText in sync without toggling pdf display mode
  currentText = pasteBox.value || '';
  currentIndex = 0;
  buildChunks();
});

/* ---------- Download / Record audio removed ---------- */

/* ---------- On load populate voices ---------- */
window.onload = () => {
  // voices may load asynchronously
  populateVoiceList();
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.onvoiceschanged = populateVoiceList;
  }

  // set defaults
  rateSlider.value = 1;
  speedLabel.textContent = '1.00×';
  updatePlayPauseUI();
  // Modal wiring
  if (moreVoicesBtn && moreVoicesModal) {
    moreVoicesBtn.addEventListener('click', ()=> {
      moreVoicesModal.style.display = 'flex';
      moreVoicesModal.setAttribute('aria-hidden','false');
    });
  }
  const closeModal = ()=>{
    if (!moreVoicesModal) return;
    moreVoicesModal.style.display = 'none';
    moreVoicesModal.setAttribute('aria-hidden','true');
  };
  if (closeMoreVoices) closeMoreVoices.addEventListener('click', closeModal);
  if (closeMoreVoicesFooter) closeMoreVoicesFooter.addEventListener('click', closeModal);
  if (moreVoicesModal) {
    moreVoicesModal.addEventListener('click', (e)=>{
      if (e.target === moreVoicesModal) closeModal();
    });
  }
  if (refreshVoicesBtn) {
    refreshVoicesBtn.addEventListener('click', ()=>{
      // Some browsers populate voices lazily; trigger refresh
      populateVoiceList();
    });
  }
  
  // Dark mode toggle
  if (darkModeToggle) {
    // Check for saved preference
    const savedMode = localStorage.getItem('darkMode');
    if (savedMode === 'true') {
      document.body.classList.add('dark-mode');
      darkModeToggle.innerHTML = '<i class="fa fa-sun"></i>';
    }
    
    darkModeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      const isDark = document.body.classList.contains('dark-mode');
      darkModeToggle.innerHTML = isDark ? '<i class="fa fa-sun"></i>' : '<i class="fa fa-moon"></i>';
      localStorage.setItem('darkMode', isDark);
    });
  }
};

/* ---------- Small precaution: cancel speech if page hidden/unload ---------- */
window.addEventListener('beforeunload', ()=> speechSynthesis.cancel());
document.addEventListener('visibilitychange', ()=> {
  // optional: pause when tab hidden
  if (document.hidden && speechSynthesis.speaking) {
    // keep it running by default; user can pause
  }
});

/* ---------- Settings change resume helpers ---------- */
function restartWithNewSettingsFromCurrentPosition(force=false){
  if (restartInFlight) return;
  // Only auto-resume if we are in playing state or explicitly forced
  const canRestart = (isPlaying || force) && !!currentText;
  if (!canRestart) return;
  const chunkSize = internalChunkSize;
  const fallback = currentIndex * chunkSize;
  const resumeAt = (typeof lastBoundaryGlobalStart === 'number' && lastBoundaryGlobalStart >= 0) ? lastBoundaryGlobalStart : fallback;
  // prevent previous utterance from advancing when cancelled
  try { if (utterance) { utterance.onend = null; utterance.onerror = null; } } catch(_) {}
  restartInFlight = true;
  speechSynthesis.cancel();
  if (!isPlaying && !force) return; // don't auto-resume if user had paused
  // compute index and offset within chunk
  const newIndex = Math.max(0, Math.floor(resumeAt / chunkSize));
  const newBase = newIndex * chunkSize;
  const offset = Math.max(0, resumeAt - newBase);
  currentIndex = newIndex;
  // small delay to let cancel settle
  setTimeout(() => playFromCurrentChunk(offset), 60);
}

function scheduleSettingRestart(){
  if (!isPlaying) return; // if user paused, don't auto-resume
  if (settingsRestartTimer) clearTimeout(settingsRestartTimer);
  settingsRestartTimer = setTimeout(() => restartWithNewSettingsFromCurrentPosition(false), 120);
}
