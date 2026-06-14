/* ============================================================
 * Local RAG Data-Packer — main front-end controller (classic script)
 *
 * Design notes
 * ------------
 * - Runs from file:// directly. Transformers.js is ESM-only and ESM
 *   <script type="module"> is blocked under file://, so we spin up a
 *   *module Worker built from a Blob URL* and dynamic-import() the
 *   library inside it. The Blob worker has its own origin → no file://
 *   CORS wall, and all heavy compute happens off the UI thread.
 * - pdf.js and sql.js are loaded as classic UMD globals in index.html.
 * - The only network traffic is the one-time model + library fetch from
 *   the CDN. User document bytes are NEVER transmitted.
 * - Bilingual UI (EN default / JA). All user-facing copy goes through
 *   t(key, params); dynamic strings store their key so a live language
 *   switch re-renders them.
 * ============================================================ */

(() => {
  'use strict';

  const TRANSFORMERS_URL =
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';

  // Lead capture for "Request pilot access". Paste a form endpoint that accepts a
  // JSON POST and returns 200 (e.g. Formspree: https://formspree.io/f/XXXX, or a
  // Tally/Make webhook). While empty, the pilot CTA stays hidden so the public demo
  // looks clean. This only ever sends what the visitor types in the form — never
  // any document content.
  const PILOT_FORM_ENDPOINT = '';

  // =====================================================================
  //  i18n
  // =====================================================================
  const I18N = {
    en: {
      'statusbar.badge': '【100% LOCAL PROCESSING】',
      'statusbar.tagline': 'Your data never leaves your computer.',
      'hero.badge': 'Air-gapped vectorization engine',
      'hero.desc':
        'Vectorize confidential documents (PDF / TXT / Markdown) <strong class="text-slate-200">entirely on-device, inside your browser</strong>, and export RAG data packs that drop straight into LangChain, LlamaIndex, and more. <span class="text-neon">Zero network. Zero server cost.</span>',
      'panel.model': 'Embedding Model',
      'panel.chunkSize': 'Chunk size',
      'panel.overlap': 'Overlap',
      'panel.backend': 'Compute backend',
      'panel.modelNote': 'The model is fetched once, then cached in your browser.',
      'backend.detecting': 'Detecting (WebGPU / WASM)…',
      'backend.webgpu': 'WebGPU (GPU accelerated)',
      'backend.wasm': 'WASM (CPU)',
      'drop.title': 'Drag & drop your files',
      'drop.or': 'or <span class="text-neon underline underline-offset-4">click to select</span> · multiple files at once',
      'drop.samples': '⚡ Test in 1 second with sample docs',
      'queue.title': 'Processing queue',
      'queue.clear': 'Clear',
      'progress.preparing': 'Preparing…',
      'result.title': 'RAG pack ready',
      'stat.docs': 'Documents',
      'stat.chunks': 'Chunks',
      'stat.dims': 'Vector dims',
      'stat.size': 'Pack size',
      'export.json': '⬇ Export Secure RAG Pack (.json)',
      'export.sqlite': '⬇ Export SQLite (.sqlite)',
      'export.note': "Files are saved locally through your browser's download. Nothing is ever uploaded.",
      'preview.summary': 'Output schema preview',
      'cta.pilot': 'Request pilot access',
      'modal.title': 'Request pilot access',
      'modal.subtitle': "Tell us about your use case — we'll reach out about a pilot.",
      'modal.email': 'Work email',
      'modal.company': 'Company',
      'modal.usecase': 'Use case (optional)',
      'modal.submit': 'Send request',
      'modal.cancel': 'Cancel',
      'modal.sending': 'Sending…',
      'modal.success': "Thanks! We'll be in touch shortly.",
      'modal.error': "Couldn't send — please email us at the address on the listing.",
      'modal.privacy': 'This form sends only what you type here. Your documents are never uploaded.',
      'modal.emailRequired': 'Please enter a valid email.',
      // dynamic
      'net.idle': 'No data uploaded',
      'net.fetching': 'Fetching model from CDN (one-time)…',
      'net.localdone': 'No data uploaded · 100% local',
      'toast.addFirst': 'Add files first',
      'toast.engineFail': 'Engine init failed (check network / browser requirements)',
      'toast.procError': 'Processing error: {msg}',
      'toast.jsonDone': 'JSON pack exported',
      'toast.sqliteGen': 'Generating SQLite…',
      'toast.sqliteNoEngine': 'SQLite engine not loaded',
      'toast.sqliteDone': 'SQLite pack exported',
      'toast.formats': 'Supported: .txt / .md / .pdf',
      'toast.sampleFail': 'Could not load samples (file:// is limited in some browsers — use a local server)',
      'err.noText': 'No extractable text was found',
      'stage.initEngine': 'Initializing the embedding engine…',
      'stage.downloading': 'Downloading model… (first run only, then cached)',
      'stage.parsing': 'Parsing file {i}/{n}… ({name})',
      'stage.embedding': 'Generating vectors… ({done}/{total})',
      'stage.packaged': 'Packaging complete',
      'stage.error': 'An error occurred',
      'detail.dimsBatch': 'dim {dims} · batch {a}/{b}',
      'detail.filePct': '{file} — {pct}%',
      'detail.modelReady': 'Model ready',
      'file.queued': 'Queued',
      'file.parsing': 'Parsing…',
      'file.readFail': 'Read failed',
      'file.nChunks': '{n} chunks',
    },
    ja: {
      'statusbar.badge': '【100% ローカル処理】',
      'statusbar.tagline': 'データが端末から出ることはありません。',
      'hero.badge': '完全エアギャップのベクトル化エンジン',
      'hero.desc':
        '機密文書（PDF / TXT / Markdown）を<strong class="text-slate-200">ブラウザ内で完全ローカル</strong>にベクトル化し、LangChain・LlamaIndex 等にそのまま読み込める RAG データパックを書き出します。<span class="text-neon">通信ゼロ・サーバー維持費ゼロ。</span>',
      'panel.model': '埋め込みモデル',
      'panel.chunkSize': 'チャンクサイズ',
      'panel.overlap': 'オーバーラップ',
      'panel.backend': '計算バックエンド',
      'panel.modelNote': 'モデルは初回のみ取得し、以後ブラウザにキャッシュされます。',
      'backend.detecting': '判定中（WebGPU / WASM）…',
      'backend.webgpu': 'WebGPU（GPU 加速）',
      'backend.wasm': 'WASM（CPU）',
      'drop.title': 'ファイルをドラッグ＆ドロップ',
      'drop.or': 'または<span class="text-neon underline underline-offset-4">クリックして選択</span> ・ 複数ファイル同時投入可',
      'drop.samples': '⚡ サンプル文書で1秒テスト',
      'queue.title': '処理キュー',
      'queue.clear': 'クリア',
      'progress.preparing': '準備中…',
      'result.title': 'RAG パック生成完了',
      'stat.docs': 'ドキュメント',
      'stat.chunks': 'チャンク',
      'stat.dims': 'ベクトル次元',
      'stat.size': 'パックサイズ',
      'export.json': '⬇ セキュアRAGパックを書き出す (.json)',
      'export.sqlite': '⬇ SQLite を書き出す (.sqlite)',
      'export.note': 'ファイルはブラウザのダウンロード経由でローカルに直接保存されます。アップロードは一切行われません。',
      'preview.summary': '出力スキーマ・プレビュー',
      'cta.pilot': 'パイロット利用を申し込む',
      'modal.title': 'パイロット利用の申し込み',
      'modal.subtitle': 'ユースケースを教えてください。パイロットについてご連絡します。',
      'modal.email': '業務メールアドレス',
      'modal.company': '会社名',
      'modal.usecase': 'ユースケース（任意）',
      'modal.submit': '送信する',
      'modal.cancel': 'キャンセル',
      'modal.sending': '送信中…',
      'modal.success': 'ありがとうございます。追ってご連絡します。',
      'modal.error': '送信できませんでした。掲載のメールアドレスへご連絡ください。',
      'modal.privacy': 'このフォームは入力内容のみを送信します。文書がアップロードされることはありません。',
      'modal.emailRequired': '有効なメールアドレスを入力してください。',
      // dynamic
      'net.idle': 'データ未送信',
      'net.fetching': 'モデルを取得中（初回のみ）…',
      'net.localdone': 'データ未送信 · 完全ローカル処理',
      'toast.addFirst': '先にファイルを追加してください',
      'toast.engineFail': 'エンジン初期化に失敗しました（ネットワーク/ブラウザ要件をご確認ください）',
      'toast.procError': '処理エラー: {msg}',
      'toast.jsonDone': 'JSON パックを書き出しました',
      'toast.sqliteGen': 'SQLite を生成中…',
      'toast.sqliteNoEngine': 'SQLite エンジン未ロード',
      'toast.sqliteDone': 'SQLite パックを書き出しました',
      'toast.formats': '対応形式: .txt / .md / .pdf',
      'toast.sampleFail': 'サンプル取得失敗（file:// では一部ブラウザで制限あり。ローカルサーバ推奨）',
      'err.noText': '抽出可能なテキストがありませんでした',
      'stage.initEngine': 'Embedding エンジンを初期化中…',
      'stage.downloading': 'モデルをダウンロード中…（初回のみ・以後キャッシュ）',
      'stage.parsing': '{i}/{n} ファイルを解析中…（{name}）',
      'stage.embedding': 'ベクトルを生成中…（{done}/{total}）',
      'stage.packaged': 'パッケージングを完了しました',
      'stage.error': 'エラーが発生しました',
      'detail.dimsBatch': '次元数 {dims} · バッチ {a}/{b}',
      'detail.filePct': '{file} — {pct}%',
      'detail.modelReady': 'モデル準備完了',
      'file.queued': '待機中',
      'file.parsing': '解析中…',
      'file.readFail': '読込失敗',
      'file.nChunks': '{n} チャンク',
    },
  };

  let lang = localStorage.getItem('lrp-lang') || 'en';
  if (!I18N[lang]) lang = 'en';

  function t(key, params) {
    let s = (I18N[lang] && I18N[lang][key]) ?? I18N.en[key] ?? key;
    if (params) for (const k in params) s = s.split('{' + k + '}').join(params[k]);
    return s;
  }

  function applyStaticI18n() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
    });
    document.querySelectorAll('#lang-toggle .lang-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.lang === lang);
    });
  }

  function switchLang(next) {
    if (!I18N[next] || next === lang) {
      // still refresh active button state
    }
    lang = I18N[next] ? next : 'en';
    localStorage.setItem('lrp-lang', lang);
    applyStaticI18n();
    refreshDynamic();
    renderQueue();
    if (!els.resultWrap.classList.contains('hidden')) renderResults(true);
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const els = {
    dropzone: $('dropzone'),
    fileInput: $('file-input'),
    loadSamples: $('load-samples'),
    queueWrap: $('queue-wrap'),
    fileList: $('file-list'),
    clearBtn: $('clear-btn'),
    progressWrap: $('progress-wrap'),
    progressStage: $('progress-stage'),
    progressPct: $('progress-pct'),
    progressBar: $('progress-bar'),
    progressDetail: $('progress-detail'),
    resultWrap: $('result-wrap'),
    statDocs: $('stat-docs'),
    statChunks: $('stat-chunks'),
    statDims: $('stat-dims'),
    statSize: $('stat-size'),
    exportJson: $('export-json'),
    exportSqlite: $('export-sqlite'),
    preview: $('preview'),
    modelSelect: $('model-select'),
    chunkSize: $('chunk-size'),
    chunkOverlap: $('chunk-overlap'),
    backendText: $('backend-text'),
    backendBadge: $('backend-badge'),
    netText: $('net-text'),
    netIndicator: $('net-indicator'),
    langToggle: $('lang-toggle'),
    toast: $('toast'),
    // pilot CTA + modal
    ctaHero: $('cta-pilot-hero'),
    ctaResult: $('cta-pilot-result'),
    pilotModal: $('pilot-modal'),
    pilotBackdrop: $('pilot-backdrop'),
    pilotForm: $('pilot-form'),
    pilotEmail: $('pilot-email'),
    pilotCompany: $('pilot-company'),
    pilotUsecase: $('pilot-usecase'),
    pilotSubmit: $('pilot-submit'),
    pilotCancel: $('pilot-cancel'),
    pilotStatus: $('pilot-status'),
  };

  // ---------- App state ----------
  const state = {
    files: [],          // { id, name, size, status, statusKey, statusParams, chunks: [] }
    pack: [],           // final records
    dims: 0,
    busy: false,
    worker: null,
    modelReady: false,
    modelId: null,
    backendVal: null,
    pendingResolvers: new Map(), // requestId -> {resolve, reject, onProgress}
    reqSeq: 0,
    // remembered dynamic UI (so a language switch can re-render live)
    ui: { stageKey: 'progress.preparing', stageParams: null, pct: 0,
          detailKey: null, detailParams: null, detailRaw: '',
          netKey: 'net.idle', netKind: 'idle' },
  };

  // =====================================================================
  //  Worker (built from a Blob so it runs under file://)
  // =====================================================================
  function buildWorker() {
    const workerSrc = `
      let extractor = null;
      let activeModel = null;
      let backend = 'wasm';

      async function loadLib() {
        const mod = await import(${JSON.stringify(TRANSFORMERS_URL)});
        mod.env.allowLocalModels = false;
        return mod;
      }

      async function ensureModel(modelId, post) {
        if (extractor && activeModel === modelId) return;
        const { pipeline } = await loadLib();

        let device = 'wasm';
        if (typeof navigator !== 'undefined' && navigator.gpu) {
          try {
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter) device = 'webgpu';
          } catch (_) { device = 'wasm'; }
        }

        const opts = {
          device,
          progress_callback: (p) => post({ type: 'model-progress', payload: p }),
        };

        try {
          extractor = await pipeline('feature-extraction', modelId, opts);
        } catch (err) {
          if (device === 'webgpu') {
            device = 'wasm';
            extractor = await pipeline('feature-extraction', modelId, {
              device,
              progress_callback: opts.progress_callback,
            });
          } else {
            throw err;
          }
        }
        backend = device;
        activeModel = modelId;
        post({ type: 'backend', payload: { backend } });
      }

      self.onmessage = async (e) => {
        const { type, requestId } = e.data;
        const post = (m) => self.postMessage(Object.assign({ requestId }, m));
        try {
          if (type === 'init') {
            await ensureModel(e.data.modelId, post);
            post({ type: 'init-done', payload: { backend } });
            return;
          }
          if (type === 'embed') {
            await ensureModel(e.data.modelId, post);
            const texts = e.data.texts;
            const output = await extractor(texts, { pooling: 'mean', normalize: true });
            const vectors = output.tolist();
            post({ type: 'embed-done', payload: { vectors } });
            return;
          }
        } catch (err) {
          post({ type: 'error', payload: { message: (err && err.message) || String(err) } });
        }
      };
    `;
    const blob = new Blob([workerSrc], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url, { type: 'module' });

    worker.onmessage = (e) => {
      const { type, requestId, payload } = e.data;
      const entry = state.pendingResolvers.get(requestId);

      if (type === 'model-progress') {
        handleModelProgress(payload);
        if (entry && entry.onProgress) entry.onProgress(payload);
        return;
      }
      if (type === 'backend') {
        setBackend(payload.backend);
        return;
      }
      if (!entry) return;

      if (type === 'init-done' || type === 'embed-done') {
        state.pendingResolvers.delete(requestId);
        entry.resolve(payload);
      } else if (type === 'error') {
        state.pendingResolvers.delete(requestId);
        entry.reject(new Error(payload.message));
      }
    };
    worker.onerror = (e) => {
      console.error('Worker error', e);
      toast(t('toast.engineFail'), true);
    };
    return worker;
  }

  function callWorker(message, onProgress) {
    return new Promise((resolve, reject) => {
      const requestId = ++state.reqSeq;
      state.pendingResolvers.set(requestId, { resolve, reject, onProgress });
      state.worker.postMessage(Object.assign({ requestId }, message));
    });
  }

  function getWorker() {
    if (!state.worker) state.worker = buildWorker();
    return state.worker;
  }

  // =====================================================================
  //  Text extraction
  // =====================================================================
  async function readFileAsText(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf') || file.type === 'application/pdf') {
      return extractPdfText(file);
    }
    return file.text();
  }

  async function extractPdfText(file) {
    if (!window.pdfjsLib) throw new Error('PDF parser not loaded');
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.js';
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let out = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((it) => it.str).join(' ');
      out += pageText + '\n\n';
    }
    return out;
  }

  // =====================================================================
  //  Chunking — sentence-aware, fixed-size with overlap
  // =====================================================================
  function chunkText(text, size, overlap) {
    const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
    if (!clean) return [];

    // Split at paragraph + sentence boundaries (JP 。！？ and Western .!?
    // and newlines), keeping delimiters.
    const units = clean
      .split(/(?<=[。．！？!?\n])/)
      .map((s) => s.trim())
      .filter(Boolean);

    const chunks = [];
    let current = '';

    const pushCurrent = () => {
      const t2 = current.trim();
      if (t2) chunks.push(t2);
    };

    for (const unit of units) {
      if (unit.length > size) {
        pushCurrent();
        current = '';
        for (let i = 0; i < unit.length; i += size - overlap) {
          chunks.push(unit.slice(i, i + size));
        }
        continue;
      }
      if ((current + ' ' + unit).trim().length > size && current) {
        pushCurrent();
        const tail = current.slice(Math.max(0, current.length - overlap));
        current = (tail + ' ' + unit).trim();
      } else {
        current = current ? current + ' ' + unit : unit;
      }
    }
    pushCurrent();
    return chunks;
  }

  // Rough token estimate: CJK chars ≈ 1 token each; latin ≈ word/0.75.
  function estimateTokens(text) {
    const cjk = (text.match(/[　-鿿＀-￯]/g) || []).length;
    const rest = text.replace(/[　-鿿＀-￯]/g, ' ');
    const words = (rest.match(/\S+/g) || []).length;
    return cjk + Math.ceil(words / 0.75);
  }

  // FNV-1a 32-bit → stable hash id for a chunk.
  function hashId(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  // =====================================================================
  //  Pipeline orchestration
  // =====================================================================
  async function processAll() {
    if (state.busy) return;
    if (state.files.length === 0) {
      toast(t('toast.addFirst'), true);
      return;
    }
    state.busy = true;
    setControlsDisabled(true);
    hide(els.resultWrap);
    show(els.progressWrap);
    state.pack = [];
    state.dims = 0;

    const modelId = els.modelSelect.value;
    const prefix = els.modelSelect.selectedOptions[0].dataset.prefix || '';
    const size = clampInt(els.chunkSize.value, 100, 4000, 500);
    const overlap = clampInt(els.chunkOverlap.value, 0, Math.floor(size / 2), 100);

    getWorker();

    try {
      // Phase 1 — model load
      setStage('stage.initEngine', null, 0);
      markNet('net.fetching', 'work');
      await callWorker({ type: 'init', modelId });
      state.modelReady = true;
      state.modelId = modelId;

      // Phase 2 — parse + chunk every file
      const totalFiles = state.files.length;
      let allChunks = []; // { fileName, content }
      for (let i = 0; i < totalFiles; i++) {
        const f = state.files[i];
        setStage('stage.parsing', { i: i + 1, n: totalFiles, name: f.name }, 5 + (i / totalFiles) * 15);
        setFileStatus(f.id, 'work', 'file.parsing');
        let raw;
        try {
          raw = await readFileAsText(f.fileObj);
        } catch (err) {
          setFileStatus(f.id, 'err', 'file.readFail');
          continue;
        }
        const chunks = chunkText(raw, size, overlap);
        f.chunks = chunks;
        f.charCount = raw.length;
        setFileStatus(f.id, 'ok', 'file.nChunks', { n: chunks.length });
        chunks.forEach((c) => allChunks.push({ fileName: f.name, content: c }));
      }

      if (allChunks.length === 0) throw new Error(t('err.noText'));

      // Phase 3 — embed in mini-batches (keeps UI responsive + granular %)
      const BATCH = 16;
      const total = allChunks.length;
      let done = 0;
      for (let i = 0; i < total; i += BATCH) {
        const batch = allChunks.slice(i, i + BATCH);
        const texts = batch.map((b) => prefix + b.content);
        const { vectors } = await callWorker({ type: 'embed', modelId, texts });
        for (let j = 0; j < batch.length; j++) {
          const vec = vectors[j];
          if (!state.dims) state.dims = vec.length;
          const content = batch[j].content;
          state.pack.push({
            id: hashId(batch[j].fileName + '::' + content),
            document_name: batch[j].fileName,
            content,
            embedding: vec.map((x) => +x.toFixed(6)),
            token_count: estimateTokens(content),
          });
        }
        done += batch.length;
        const pct = 25 + (done / total) * 73;
        setStage('stage.embedding', { done, total }, pct);
        setDetail('detail.dimsBatch', { dims: state.dims, a: Math.ceil((i + BATCH) / BATCH), b: Math.ceil(total / BATCH) });
        await microYield();
      }

      setStage('stage.packaged', null, 100);
      markNet('net.localdone', 'ok');
      renderResults();
    } catch (err) {
      console.error(err);
      toast(t('toast.procError', { msg: err.message }), true);
      setStage('stage.error', null, 0);
    } finally {
      state.busy = false;
      setControlsDisabled(false);
    }
  }

  // =====================================================================
  //  Export
  // =====================================================================
  function buildManifest() {
    return {
      format: 'local-rag-pack',
      version: '1.0',
      created_at: new Date().toISOString(),
      model: state.modelId,
      embedding_dim: state.dims,
      metric: 'cosine',
      normalized: true,
      document_count: new Set(state.pack.map((r) => r.document_name)).size,
      chunk_count: state.pack.length,
      generator: 'Local RAG Data-Packer',
    };
  }

  function exportJson() {
    if (state.pack.length === 0) return;
    const payload = { manifest: buildManifest(), records: state.pack };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    download(blob, `rag-pack-${stamp()}.json`);
    toast(t('toast.jsonDone'));
  }

  async function exportSqlite() {
    if (state.pack.length === 0) return;
    if (!window.initSqlJs) { toast(t('toast.sqliteNoEngine'), true); return; }
    toast(t('toast.sqliteGen'));
    const SQL = await initSqlJs({
      locateFile: (f) => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${f}`,
    });
    const db = new SQL.Database();
    db.run(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        document_name TEXT,
        content TEXT,
        embedding TEXT,   -- JSON float array
        token_count INTEGER
      );
    `);
    const manifest = buildManifest();
    const mstmt = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    Object.entries(manifest).forEach(([k, v]) => mstmt.run([k, String(v)]));
    mstmt.free();

    const stmt = db.prepare(
      'INSERT INTO chunks (id, document_name, content, embedding, token_count) VALUES (?,?,?,?,?)'
    );
    db.run('BEGIN');
    for (const r of state.pack) {
      stmt.run([r.id, r.document_name, r.content, JSON.stringify(r.embedding), r.token_count]);
    }
    db.run('COMMIT');
    stmt.free();

    const data = db.export();
    db.close();
    download(new Blob([data], { type: 'application/x-sqlite3' }), `rag-pack-${stamp()}.sqlite`);
    toast(t('toast.sqliteDone'));
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // =====================================================================
  //  UI rendering
  // =====================================================================
  function renderResults(skipAnim) {
    const docCount = new Set(state.pack.map((r) => r.document_name)).size;
    const bytes = new Blob([JSON.stringify({ manifest: buildManifest(), records: state.pack })]).size;
    els.statDocs.textContent = docCount;
    els.statChunks.textContent = state.pack.length;
    els.statDims.textContent = state.dims;
    els.statSize.textContent = humanSize(bytes);

    const sample = state.pack.slice(0, 1).map((r) => ({
      ...r,
      embedding: r.embedding.slice(0, 6).concat(['…(' + r.embedding.length + ' dims)']),
    }));
    els.preview.textContent = JSON.stringify(
      { manifest: buildManifest(), records: sample },
      null,
      2
    );

    show(els.resultWrap);
    if (!skipAnim) {
      countUp(els.statChunks, state.pack.length);
      countUp(els.statDocs, docCount);
      els.resultWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function renderQueue() {
    if (state.files.length === 0) { hide(els.queueWrap); return; }
    show(els.queueWrap);
    els.fileList.innerHTML = '';
    for (const f of state.files) {
      const statusText = f.statusKey ? t(f.statusKey, f.statusParams) : t('file.queued');
      const li = document.createElement('li');
      li.className = 'file-row flex items-center gap-3 rounded-xl border border-edge bg-panel px-4 py-3';
      li.innerHTML = `
        <span class="dot dot-${dotClass(f.status)} h-2.5 w-2.5 rounded-full shrink-0"></span>
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm text-slate-200">${escapeHtml(f.name)}</div>
          <div class="text-[11px] text-slate-500">${humanSize(f.size)} · <span data-status="${f.id}">${escapeHtml(statusText)}</span></div>
        </div>
        <button data-remove="${f.id}" class="text-slate-600 hover:text-danger transition shrink-0" title="remove">✕</button>
      `;
      els.fileList.appendChild(li);
    }
    els.fileList.querySelectorAll('[data-remove]').forEach((b) =>
      b.addEventListener('click', () => removeFile(b.dataset.remove))
    );
  }

  function dotClass(s) {
    return s === 'ok' ? 'ok' : s === 'work' ? 'work' : s === 'err' ? 'err' : 'idle';
  }
  function setFileStatus(id, status, key, params) {
    const f = state.files.find((x) => x.id === id);
    if (!f) return;
    f.status = status;
    f.statusKey = key;
    f.statusParams = params || null;
    const txt = t(key, params);
    const dotEl = els.fileList.querySelector(`[data-remove="${id}"]`)?.closest('li')?.querySelector('.dot');
    const txtEl = els.fileList.querySelector(`[data-status="${id}"]`);
    if (dotEl) dotEl.className = `dot dot-${dotClass(status)} h-2.5 w-2.5 rounded-full shrink-0`;
    if (txtEl) txtEl.textContent = txt;
  }

  // ---------- model progress (download) ----------
  const fileProgress = {};
  function handleModelProgress(p) {
    if (!p || !p.status) return;
    if (p.status === 'progress' && p.file) {
      fileProgress[p.file] = p.progress || 0;
      const vals = Object.values(fileProgress);
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      setStage('stage.downloading', null, Math.min(24, avg * 0.24));
      setDetail('detail.filePct', { file: shortName(p.file), pct: Math.round(p.progress || 0) });
    } else if (p.status === 'ready' || p.status === 'done') {
      setDetail('detail.modelReady', null);
    }
  }

  function setStage(key, params, pct) {
    show(els.progressWrap);
    state.ui.stageKey = key;
    state.ui.stageParams = params;
    state.ui.pct = pct;
    els.progressStage.textContent = t(key, params);
    const v = Math.max(0, Math.min(100, Math.round(pct)));
    els.progressBar.style.width = v + '%';
    els.progressPct.textContent = v + '%';
  }

  function setDetail(key, params) {
    state.ui.detailKey = key;
    state.ui.detailParams = params;
    els.progressDetail.textContent = t(key, params);
  }

  function setBackend(b) {
    state.backendVal = b;
    els.backendText.textContent = b === 'webgpu' ? t('backend.webgpu') : t('backend.wasm');
    els.backendBadge.querySelector('span').className =
      'h-2 w-2 rounded-full ' + (b === 'webgpu' ? 'bg-neon' : 'bg-amber-400');
  }

  function markNet(key, kind) {
    state.ui.netKey = key;
    state.ui.netKind = kind;
    els.netText.textContent = t(key);
    const dot = els.netIndicator.querySelector('span');
    dot.className =
      'h-1.5 w-1.5 rounded-full ' +
      (kind === 'ok' ? 'bg-neon' : kind === 'work' ? 'bg-amber-400 animate-pulse' : 'bg-slate-500');
  }

  // Re-render remembered dynamic strings after a language switch.
  function refreshDynamic() {
    els.progressStage.textContent = t(state.ui.stageKey, state.ui.stageParams);
    if (state.ui.detailKey) els.progressDetail.textContent = t(state.ui.detailKey, state.ui.detailParams);
    els.netText.textContent = t(state.ui.netKey);
    if (state.backendVal) setBackend(state.backendVal);
  }

  // =====================================================================
  //  File intake
  // =====================================================================
  const ALLOWED = /\.(txt|md|markdown|pdf)$/i;
  function addFiles(fileList) {
    const incoming = Array.from(fileList).filter((f) => ALLOWED.test(f.name) || f.type === 'application/pdf' || f.type.startsWith('text/'));
    if (incoming.length === 0) { toast(t('toast.formats'), true); return; }
    for (const file of incoming) {
      state.files.push({
        id: 'f' + Math.random().toString(36).slice(2, 9),
        name: file.name,
        size: file.size,
        status: 'idle',
        statusKey: 'file.queued',
        statusParams: null,
        fileObj: file,
        chunks: [],
      });
    }
    renderQueue();
    hide(els.resultWrap);
    processAll();
  }

  function removeFile(id) {
    state.files = state.files.filter((f) => f.id !== id);
    renderQueue();
  }
  function clearAll() {
    state.files = [];
    state.pack = [];
    renderQueue();
    hide(els.resultWrap);
    hide(els.progressWrap);
  }

  // ---------- samples ----------
  const SAMPLE_FILES = [
    'sample_docs/01_security_policy_ja.md',
    'sample_docs/02_incident_response_ja.txt',
    'sample_docs/03_product_overview_en.md',
  ];
  async function loadSamples() {
    try {
      const files = [];
      for (const path of SAMPLE_FILES) {
        const res = await fetch(path);
        if (!res.ok) throw new Error(path);
        const blob = await res.blob();
        files.push(new File([blob], path.split('/').pop(), { type: blob.type || 'text/plain' }));
      }
      addFiles(files);
    } catch (e) {
      toast(t('toast.sampleFail'), true);
    }
  }

  // =====================================================================
  //  Helpers
  // =====================================================================
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');
  const microYield = () => new Promise((r) => setTimeout(r, 0));
  function clampInt(v, min, max, def) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
  }
  function humanSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  function stamp() {
    const d = new Date();
    const p = (n) => ('0' + n).slice(-2);
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
  function shortName(s) { return s.length > 38 ? '…' + s.slice(-36) : s; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function setControlsDisabled(d) {
    [els.modelSelect, els.chunkSize, els.chunkOverlap, els.loadSamples].forEach((e) => {
      if (e) e.disabled = d;
    });
  }
  let toastTimer;
  function toast(msg, isErr) {
    els.toast.textContent = msg;
    els.toast.classList.toggle('border-danger', !!isErr);
    els.toast.classList.toggle('text-danger', !!isErr);
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
  }
  function countUp(el, target) {
    const dur = 600, start = performance.now();
    function tick(now) {
      const t2 = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - t2, 3)));
      if (t2 < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // =====================================================================
  //  Events
  // =====================================================================
  els.dropzone.addEventListener('click', (e) => {
    if (e.target.closest('#load-samples')) return;
    els.fileInput.click();
  });
  els.fileInput.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

  ['dragenter', 'dragover'].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.add('dragover'); })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.remove('dragover'); })
  );
  els.dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  els.loadSamples.addEventListener('click', (e) => { e.stopPropagation(); loadSamples(); });
  els.clearBtn.addEventListener('click', clearAll);
  els.exportJson.addEventListener('click', exportJson);
  els.exportSqlite.addEventListener('click', exportSqlite);
  els.langToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lang]');
    if (btn) switchLang(btn.dataset.lang);
  });

  // =====================================================================
  //  Pilot CTA + lead-capture modal
  // =====================================================================
  function initPilotCTA() {
    if (!PILOT_FORM_ENDPOINT) return; // keep CTA hidden until an endpoint is set
    [els.ctaHero, els.ctaResult].forEach((b) => b && b.classList.remove('hidden'));
  }
  function openPilotModal() {
    if (!els.pilotModal) return;
    els.pilotStatus.textContent = '';
    els.pilotStatus.className = 'mt-3 text-xs';
    show(els.pilotModal);
    setTimeout(() => els.pilotEmail && els.pilotEmail.focus(), 50);
  }
  function closePilotModal() { if (els.pilotModal) hide(els.pilotModal); }

  async function submitPilot(e) {
    e.preventDefault();
    const email = (els.pilotEmail.value || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      els.pilotStatus.textContent = t('modal.emailRequired');
      els.pilotStatus.className = 'mt-3 text-xs text-danger';
      return;
    }
    const payload = {
      email,
      company: (els.pilotCompany.value || '').trim(),
      use_case: (els.pilotUsecase.value || '').trim(),
      source: 'live-demo',
      page: location.href,
    };
    els.pilotSubmit.disabled = true;
    els.pilotStatus.textContent = t('modal.sending');
    els.pilotStatus.className = 'mt-3 text-xs text-slate-400';
    try {
      const res = await fetch(PILOT_FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('bad status ' + res.status);
      els.pilotStatus.textContent = t('modal.success');
      els.pilotStatus.className = 'mt-3 text-xs text-neon';
      els.pilotForm.reset();
      setTimeout(closePilotModal, 1800);
    } catch (err) {
      console.error('pilot submit failed', err);
      els.pilotStatus.textContent = t('modal.error');
      els.pilotStatus.className = 'mt-3 text-xs text-danger';
    } finally {
      els.pilotSubmit.disabled = false;
    }
  }

  if (els.ctaHero) els.ctaHero.addEventListener('click', openPilotModal);
  if (els.ctaResult) els.ctaResult.addEventListener('click', openPilotModal);
  if (els.pilotCancel) els.pilotCancel.addEventListener('click', closePilotModal);
  if (els.pilotBackdrop) els.pilotBackdrop.addEventListener('click', closePilotModal);
  if (els.pilotForm) els.pilotForm.addEventListener('submit', submitPilot);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.pilotModal && !els.pilotModal.classList.contains('hidden')) closePilotModal();
  });

  // initial paint
  applyStaticI18n();
  markNet('net.idle', 'idle');
  initPilotCTA();

  // backend hint before any run
  (async () => {
    if (navigator.gpu) {
      try {
        const a = await navigator.gpu.requestAdapter();
        setBackend(a ? 'webgpu' : 'wasm');
      } catch { setBackend('wasm'); }
    } else {
      setBackend('wasm');
    }
  })();

  console.log('%cLocal RAG Data-Packer ready — 100% on-device.', 'color:#22e6c8;font-weight:bold');
})();
