(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const body = document.body;
  const analysisOptions = $$('.analysis-option');
  const fileInput = $('#fileInput');
  const dropZone = $('#dropZone');
  const selectedFile = $('#selectedFile');
  const fileName = $('#fileName');
  const fileMeta = $('#fileMeta');
  const clearFileButton = $('#clearFileButton');
  const inspectButton = $('#inspectButton');
  const mappingPanel = $('#mappingPanel');
  const sheetSelect = $('#sheetSelect');
  const headerRowSelect = $('#headerRowSelect');
  const headerChips = $('#headerChips');
  const documentSelect = $('#documentSelect');
  const referenceSelect = $('#referenceSelect');
  const amountSelect = $('#amountSelect');
  const textSelect = $('#textSelect');
  const partnerSelect = $('#partnerSelect');
  const referenceRow = $('#referenceRow');
  const documentHint = $('#documentHint');
  const confirmMappingButton = $('#confirmMappingButton');
  const mappingSummary = $('#mappingSummary');
  const mappingPreview = $('#mappingPreview');
  const runPanel = $('#runPanel');
  const runStatus = $('#runStatus');
  const runAnalysisButton = $('#runAnalysisButton');
  const downloadButton = $('#downloadButton');
  const resultBox = $('#resultBox');
  const analysisProgress = $('#analysisProgress');
  const analysisProgressValue = $('#analysisProgressValue');
  const toast = $('#toast');
  const toolThemeToggle = $('#toolThemeToggle');
  const flowSteps = [$('#stepUpload'), $('#stepMap'), $('#stepRun'), $('#stepDone')];

  let analysisType = 'sales';
  let currentFile = null;
  let currentJobId = null;
  let inspection = null;
  let currentHeaders = [];
  let confirmedConfig = null;
  let running = false;

  function applyTheme(theme) {
    body.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('liuxianlab-theme', theme);
  }

  function initTheme() {
    const saved = localStorage.getItem('liuxianlab-theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved || (systemDark ? 'dark' : 'light'));
  }

  function showToast(message, type = 'normal') {
    toast.textContent = message;
    toast.classList.toggle('error', type === 'error');
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function setStep(stepNumber) {
    flowSteps.forEach((step, index) => {
      const number = index + 1;
      step.classList.toggle('active', number === stepNumber);
      step.classList.toggle('done', number < stepNumber);
    });
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function setProgress(value, message) {
    const safe = Math.max(0, Math.min(100, Number(value) || 0));
    analysisProgress.style.width = `${safe}%`;
    analysisProgressValue.textContent = `${safe}%`;
    if (message) runStatus.textContent = message;
  }

  async function readResponseJson(response) {
    if (response.status === 401) {
      window.location.replace('/login');
      throw new Error('登录已失效，请重新登录。');
    }

    if (response.status === 413) {
      throw new Error('文件过大，请上传 25 MB 以内的 Excel。');
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      return response.json();
    }

    const text = await response.text();
    console.error('Unexpected server response:', text.slice(0, 500));
    throw new Error(`服务器暂时无法处理请求（${response.status}）。`);
  }

  function resetAnalysisResult() {
    confirmedConfig = null;
    runPanel.hidden = true;
    resultBox.hidden = true;
    downloadButton.hidden = true;
    downloadButton.href = '#';
    setProgress(0, '可以开始分析。');
  }

  function resetInspection() {
    currentJobId = null;
    inspection = null;
    currentHeaders = [];
    mappingPanel.hidden = true;
    mappingSummary.hidden = true;
    resetAnalysisResult();
    setStep(1);
  }

  function invalidateConfirmedMapping() {
    if (!confirmedConfig) return;
    confirmedConfig = null;
    mappingSummary.hidden = true;
    runPanel.hidden = true;
    resultBox.hidden = true;
    downloadButton.hidden = true;
    setStep(2);
  }

  function useFile(file) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      showToast('请选择 XLSX 文件。', 'error');
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      showToast('文件不能超过 25 MB。', 'error');
      return;
    }

    currentFile = file;
    fileName.textContent = file.name;
    fileMeta.textContent = `${formatBytes(file.size)} · XLSX`;
    selectedFile.hidden = false;
    inspectButton.disabled = false;
    resetInspection();
  }

  function clearFile() {
    if (running) return;
    currentFile = null;
    fileInput.value = '';
    selectedFile.hidden = true;
    inspectButton.disabled = true;
    resetInspection();
  }

  function selectedSheet() {
    if (!inspection) return null;
    return inspection.sheets.find((sheet) => sheet.name === sheetSelect.value) || null;
  }

  function selectedHeaderRow() {
    const sheet = selectedSheet();
    if (!sheet) return null;
    const rowNumber = Number(headerRowSelect.value);
    return sheet.rows.find((row) => row.rowNumber === rowNumber) || null;
  }

  function normalizeHeader(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[_\-]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function guessHeader(headers, keywords) {
    const normalizedKeywords = keywords.map(normalizeHeader);

    for (const header of headers) {
      if (normalizedKeywords.includes(normalizeHeader(header))) return header;
    }

    for (const header of headers) {
      const normalized = normalizeHeader(header);
      if (normalizedKeywords.some((keyword) => normalized.includes(keyword))) return header;
    }

    return '';
  }

  function fillSelect(select, headers, guessed) {
    select.innerHTML = '';

    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '请选择';
    select.appendChild(blank);

    headers.forEach((header) => {
      const option = document.createElement('option');
      option.value = header;
      option.textContent = header;
      option.selected = header === guessed;
      select.appendChild(option);
    });
  }

  function populateMappings(headers) {
    const documentGuess = analysisType === 'sales'
      ? guessHeader(headers, ['sales document', 'sales doc', '销售凭证', '销售单据'])
      : guessHeader(headers, ['document number', 'document no', 'document', '凭证号', '凭证编号']);

    fillSelect(documentSelect, headers, documentGuess);
    fillSelect(referenceSelect, headers, guessHeader(headers, ['reference', 'reference no', 'ref', '参考', '参考号']));
    fillSelect(amountSelect, headers, guessHeader(headers, ['amount in local currency', 'local currency amount', 'amount', '本币金额', '金额']));
    fillSelect(textSelect, headers, guessHeader(headers, ['text', 'description', 'item text', '文本', '描述']));
    fillSelect(partnerSelect, headers, guessHeader(headers, ['trading partner', 'partner', '交易伙伴', '贸易伙伴']));
  }

  function renderHeaderRow() {
    const row = selectedHeaderRow();
    if (!row) return;

    currentHeaders = row.values
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    headerChips.innerHTML = '';
    currentHeaders.forEach((header) => {
      const chip = document.createElement('span');
      chip.className = 'header-chip';
      chip.textContent = header;
      headerChips.appendChild(chip);
    });

    populateMappings(currentHeaders);
    invalidateConfirmedMapping();
  }

  function populateHeaderRows() {
    const sheet = selectedSheet();
    headerRowSelect.innerHTML = '';
    if (!sheet) return;

    sheet.rows.forEach((row) => {
      const option = document.createElement('option');
      option.value = String(row.rowNumber);
      const preview = row.values.filter(Boolean).slice(0, 3).join(' | ');
      option.textContent = `第 ${row.rowNumber} 行${preview ? ` · ${preview}` : ''}`;
      option.selected = row.rowNumber === sheet.detectedHeaderRow;
      headerRowSelect.appendChild(option);
    });

    renderHeaderRow();
  }

  function renderInspection() {
    sheetSelect.innerHTML = '';

    inspection.sheets.forEach((sheet) => {
      const option = document.createElement('option');
      option.value = sheet.name;
      option.textContent = sheet.name;
      sheetSelect.appendChild(option);
    });

    populateHeaderRows();
    mappingPanel.hidden = false;
    setStep(2);
    mappingPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  analysisOptions.forEach((option) => {
    option.addEventListener('click', () => {
      if (running) return;

      analysisOptions.forEach((item) => item.classList.remove('active'));
      option.classList.add('active');
      analysisType = option.dataset.analysis || 'sales';
      referenceRow.hidden = analysisType === 'income';
      documentHint.textContent = analysisType === 'sales' ? 'Sales Document' : 'Document Number';
      invalidateConfirmedMapping();

      if (currentHeaders.length) populateMappings(currentHeaders);
    });
  });

  fileInput.addEventListener('change', () => useFile(fileInput.files?.[0]));
  clearFileButton.addEventListener('click', clearFile);

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (!running) dropZone.classList.add('dragging');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('dragging');
    });
  });

  dropZone.addEventListener('drop', (event) => {
    if (running) return;
    useFile(event.dataTransfer?.files?.[0]);
  });

  inspectButton.addEventListener('click', async () => {
    if (!currentFile) return;

    inspectButton.disabled = true;
    inspectButton.textContent = '正在读取…';
    resetInspection();

    const formData = new FormData();
    formData.append('file', currentFile);
    formData.append('analysisType', analysisType);

    try {
      const response = await fetch('/api/sales-income/inspect', { method: 'POST', body: formData });
      const payload = await readResponseJson(response);

      if (!response.ok) throw new Error(payload.error || '读取 Excel 失败。');
      if (!payload.sheets?.length) throw new Error('没有检测到工作表。');

      currentJobId = payload.jobId;
      inspection = payload;
      renderInspection();
      showToast('文件结构已读取。');
    } catch (error) {
      console.error(error);
      showToast(error.message || '读取 Excel 失败。', 'error');
    } finally {
      inspectButton.disabled = !currentFile;
      inspectButton.textContent = '重新读取';
    }
  });

  sheetSelect.addEventListener('change', () => {
    invalidateConfirmedMapping();
    populateHeaderRows();
  });

  headerRowSelect.addEventListener('change', () => {
    invalidateConfirmedMapping();
    renderHeaderRow();
  });

  [documentSelect, referenceSelect, amountSelect, textSelect, partnerSelect].forEach((select) => {
    select.addEventListener('change', invalidateConfirmedMapping);
  });

  confirmMappingButton.addEventListener('click', () => {
    const mapping = {
      document: documentSelect.value,
      amount: amountSelect.value,
      text: textSelect.value,
      partner: partnerSelect.value
    };

    if (analysisType === 'sales') mapping.reference = referenceSelect.value;

    const missing = Object.entries(mapping)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missing.length) {
      showToast('请完成所有字段选择。', 'error');
      return;
    }

    confirmedConfig = {
      jobId: currentJobId,
      analysisType,
      sheetName: sheetSelect.value,
      headerRow: Number(headerRowSelect.value),
      mapping
    };

    mappingPreview.textContent = JSON.stringify(confirmedConfig, null, 2);
    mappingSummary.hidden = false;
    runPanel.hidden = false;
    resultBox.hidden = true;
    downloadButton.hidden = true;
    setProgress(0, '可以开始分析。');
    setStep(3);
    runPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  runAnalysisButton.addEventListener('click', async () => {
    if (running || !confirmedConfig || !currentJobId) return;

    running = true;
    runAnalysisButton.disabled = true;
    resultBox.hidden = true;
    downloadButton.hidden = true;
    setProgress(20, '正在准备分析…');

    try {
      setProgress(55, '正在执行分析…');

      const response = await fetch(`/api/sales-income/jobs/${currentJobId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisType: confirmedConfig.analysisType,
          sheetName: confirmedConfig.sheetName,
          headerRow: confirmedConfig.headerRow,
          mapping: confirmedConfig.mapping
        })
      });

      const payload = await readResponseJson(response);
      if (!response.ok) throw new Error(payload.error || '分析失败。');

      setProgress(100, '分析完成。');
      downloadButton.href = payload.downloadUrl;
      downloadButton.hidden = false;
      resultBox.hidden = false;
      setStep(4);
      showToast('分析完成。');
    } catch (error) {
      console.error(error);
      setProgress(0, '分析失败。');
      showToast(error.message || '分析失败。', 'error');
    } finally {
      running = false;
      runAnalysisButton.disabled = false;
    }
  });

  toolThemeToggle.addEventListener('click', () => {
    applyTheme(body.classList.contains('dark') ? 'light' : 'dark');
  });

  initTheme();
  clearFile();
})();
