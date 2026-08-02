import * as pdfjsLib from './node_modules/pdfjs-dist/build/pdf.mjs';
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
} from './node_modules/pdfjs-dist/web/pdf_viewer.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  './node_modules/pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href;

const container = document.getElementById('preview-container');
const viewerElement = document.getElementById('pdf-viewer');
const askButton = document.getElementById('ask-selection');
const emptyState = document.getElementById('preview-empty');
const selections = new Map();
const pageImageUrls = [];
let pendingSelection = null;
let pdfViewer = null;
let semanticTextLayer = null;

function normalizedQuote(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 2_000);
}

function pageForNode(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest?.('.page[data-page-number]') || null;
}

function intersectingPage(rect) {
  const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + Math.min(rect.width / 2, 8)));
  const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + Math.min(rect.height / 2, 8)));
  return document.elementsFromPoint(x, y).find((element) => element.matches?.('.page[data-page-number]'))
    || document.elementsFromPoint(x, y).map((element) => element.closest?.('.page[data-page-number]')).find(Boolean)
    || null;
}

function selectionGeometry(selection) {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const quote = normalizedQuote(selection.toString());
  if (!quote) return null;
  const range = selection.getRangeAt(0);
  const fallbackPage = pageForNode(range.commonAncestorContainer)
    || pageForNode(range.startContainer)
    || pageForNode(range.endContainer);

  const rects = [];
  for (const clientRect of range.getClientRects()) {
    if (clientRect.width < 0.5 || clientRect.height < 0.5) continue;
    const page = intersectingPage(clientRect) || fallbackPage;
    if (!page) continue;
    const pageRect = page.getBoundingClientRect();
    const left = Math.max(clientRect.left, pageRect.left);
    const top = Math.max(clientRect.top, pageRect.top);
    const right = Math.min(clientRect.right, pageRect.right);
    const bottom = Math.min(clientRect.bottom, pageRect.bottom);
    if (right <= left || bottom <= top) continue;
    rects.push({
      page: Number(page.dataset.pageNumber),
      x: (left - pageRect.left) / pageRect.width,
      y: (top - pageRect.top) / pageRect.height,
      width: (right - left) / pageRect.width,
      height: (bottom - top) / pageRect.height,
    });
  }
  if (!rects.length) return null;
  return {
    quote,
    pages: [...new Set(rects.map((rect) => rect.page))].sort((left, right) => left - right),
    rects,
  };
}

function hideAskButton() {
  askButton.hidden = true;
  pendingSelection = null;
}

function placeAskButton(selection) {
  const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
  const rect = range?.getBoundingClientRect();
  if (!rect) return hideAskButton();
  pendingSelection = selection;
  askButton.hidden = false;
  const width = askButton.offsetWidth || 144;
  const height = askButton.offsetHeight || 38;
  const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.right - width));
  const preferredTop = rect.bottom + 10;
  const top = preferredTop + height <= window.innerHeight - 12
    ? preferredTop
    : Math.max(12, rect.top - height - 10);
  askButton.style.left = `${left}px`;
  askButton.style.top = `${top}px`;
}

function captureCurrentSelection() {
  const selection = selectionGeometry(window.getSelection());
  if (selection) placeAskButton(selection);
  else hideAskButton();
}

function layerForPage(page) {
  let layer = page.querySelector(':scope > .artifact-selection-layer');
  if (layer) return layer;
  layer = document.createElement('div');
  layer.className = 'artifact-selection-layer';
  layer.setAttribute('aria-hidden', 'true');
  page.append(layer);
  return layer;
}

function renderSelections() {
  document.querySelectorAll('.artifact-selection-layer').forEach((layer) => layer.remove());
  for (const selection of selections.values()) {
    const rectsByPage = Map.groupBy(selection.rects || [], (rect) => rect.page);
    for (const [pageNumber, rects] of rectsByPage) {
      const page = viewerElement.querySelector(`.page[data-page-number="${pageNumber}"]`);
      if (!page) continue;
      const layer = layerForPage(page);
      rects.forEach((rect, index) => {
        const mark = document.createElement('span');
        mark.className = 'artifact-selection-mark';
        mark.style.left = `${rect.x * 100}%`;
        mark.style.top = `${rect.y * 100}%`;
        mark.style.width = `${rect.width * 100}%`;
        mark.style.height = `${rect.height * 100}%`;
        if (index === 0) {
          const badge = document.createElement('b');
          badge.textContent = String(selection.number || 1);
          mark.append(badge);
        }
        layer.append(mark);
      });
    }
  }
}

function applyPageImages() {
  pageImageUrls.forEach((url, index) => {
    const page = viewerElement.querySelector(`.page[data-page-number="${index + 1}"]`);
    if (!page || page.querySelector(':scope > .artifact-rendered-page-image')) return;
    const image = document.createElement('img');
    image.className = 'artifact-rendered-page-image';
    image.src = url;
    image.alt = '';
    image.draggable = false;
    page.classList.add('office-image-backed');
    page.prepend(image);
  });
}

function applySemanticTextLayers() {
  if (!semanticTextLayer?.pages?.length) return;
  for (const pageText of semanticTextLayer.pages) {
    const page = viewerElement.querySelector(`.page[data-page-number="${pageText.page}"]`);
    if (!page || page.querySelector(':scope > .artifact-semantic-text-layer')) continue;
    const layer = document.createElement('div');
    layer.className = 'artifact-semantic-text-layer';
    layer.setAttribute('aria-label', `第 ${pageText.page} 页可选择文字`);
    page.classList.add('semantic-text-backed');
    page.append(layer);
    for (const source of pageText.spans || []) {
      const word = document.createElement('span');
      word.className = 'artifact-semantic-text-word';
      word.textContent = `${source.text} `;
      word.style.left = `${(source.x / pageText.width) * 100}%`;
      word.style.top = `${(source.y / pageText.height) * 100}%`;
      const targetWidth = (source.width / pageText.width) * page.clientWidth;
      const targetHeight = (source.height / pageText.height) * page.clientHeight;
      word.style.fontSize = `${Math.max(4, targetHeight)}px`;
      word.style.lineHeight = `${Math.max(4, targetHeight)}px`;
      layer.append(word);
      const naturalWidth = word.getBoundingClientRect().width;
      if (naturalWidth > 0 && targetWidth > 0) {
        word.style.transform = `scaleX(${targetWidth / naturalWidth})`;
      }
    }
  }
}

function refreshSemanticTextLayers() {
  document.querySelectorAll('.artifact-semantic-text-layer').forEach((layer) => layer.remove());
  window.requestAnimationFrame(applySemanticTextLayers);
}

function rememberSelection(selection) {
  if (!selection?.selectionId) return;
  selections.set(selection.selectionId, selection);
  renderSelections();
}

async function jumpToSelection(selection) {
  if (!selection?.selectionId || !selection?.pages?.length) return;
  rememberSelection(selection);
  pdfViewer.currentPageNumber = selection.pages[0];
  await new Promise((resolve) => window.setTimeout(resolve, 80));
  renderSelections();
  const badge = viewerElement.querySelector(
    `.page[data-page-number="${selection.pages[0]}"] .artifact-selection-mark b`
  );
  const mark = badge?.parentElement;
  mark?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  mark?.classList.add('locating');
  window.setTimeout(() => mark?.classList.remove('locating'), 1_500);
}

askButton.addEventListener('click', async () => {
  if (!pendingSelection) return;
  askButton.disabled = true;
  askButton.querySelector('span').textContent = '正在引用…';
  try {
    await window.meteoArtifactPreview.addSelection(pendingSelection);
    window.getSelection()?.removeAllRanges();
    hideAskButton();
  } finally {
    askButton.disabled = false;
    askButton.querySelector('span').textContent = '问 MeteoMate';
  }
});

document.addEventListener('pointerup', (event) => {
  if (askButton.contains(event.target)) return;
  window.setTimeout(captureCurrentSelection, 0);
}, true);
document.addEventListener('keyup', (event) => {
  if (event.key.startsWith('Arrow') || event.key === 'Shift') window.setTimeout(captureCurrentSelection, 0);
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
    event.preventDefault();
    captureCurrentSelection();
    if (!askButton.hidden) askButton.click();
  }
  if (event.key === 'Escape') hideAskButton();
});
container.addEventListener('scroll', hideAskButton, { passive: true });

window.meteoArtifactPreview.onHighlightSelection(rememberSelection);
window.meteoArtifactPreview.onJumpSelection(jumpToSelection);
window.meteoArtifactPreview.onRemoveSelection((selectionId) => {
  selections.delete(String(selectionId || ''));
  renderSelections();
});

async function loadDocument() {
  try {
    const documentPayload = await window.meteoArtifactPreview.loadDocument();
    const bytes = documentPayload?.bytes instanceof Uint8Array
      ? documentPayload.bytes
      : new Uint8Array(documentPayload?.bytes || []);
    for (const imageBytes of documentPayload?.pageImages || []) {
      pageImageUrls.push(URL.createObjectURL(new Blob([imageBytes], { type: 'image/png' })));
    }
    semanticTextLayer = documentPayload?.textLayer || null;
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    linkService.externalLinkEnabled = false;
    pdfViewer = new PDFViewer({
      container,
      viewer: viewerElement,
      eventBus,
      linkService,
      annotationMode: pdfjsLib.AnnotationMode.ENABLE,
      enableAutoLinking: false,
      enableSelectionRendering: true,
      removePageBorders: false,
    });
    linkService.setViewer(pdfViewer);
    const loadingTask = pdfjsLib.getDocument({
      data: bytes,
      cMapUrl: new URL('./node_modules/pdfjs-dist/cmaps/', import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('./node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
      wasmUrl: new URL('./node_modules/pdfjs-dist/wasm/', import.meta.url).href,
      isEvalSupported: false,
      useWasm: true,
    });
    const pdfDocument = await loadingTask.promise;
    pdfViewer.setDocument(pdfDocument);
    linkService.setDocument(pdfDocument);
    eventBus.on('pagesinit', () => {
      pdfViewer.currentScaleValue = 'page-width';
      applyPageImages();
      applySemanticTextLayers();
      emptyState.hidden = true;
      void window.meteoArtifactPreview.reportReady({
        pageCount: pdfDocument.numPages,
        imageBacked: pageImageUrls.length > 0,
      });
    });
    eventBus.on('textlayerrendered', renderSelections);
    eventBus.on('pagerendered', () => {
      applyPageImages();
      applySemanticTextLayers();
    });
    eventBus.on('scalechanging', () => {
      renderSelections();
      refreshSemanticTextLayers();
    });
  } catch (error) {
    emptyState.querySelector('strong').textContent = '文档加载失败';
    emptyState.querySelector('p').textContent = error?.message || '无法读取预览内容。';
    void window.meteoArtifactPreview.reportError(error?.message || '文档加载失败');
  }
}

window.addEventListener('unload', () => pageImageUrls.forEach((url) => URL.revokeObjectURL(url)));

void loadDocument();
