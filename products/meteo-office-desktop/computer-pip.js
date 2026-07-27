'use strict';

const video = document.getElementById('preview-video');
const fallbackImage = document.getElementById('fallback-image');
const placeholder = document.getElementById('placeholder');
const placeholderTitle = document.getElementById('placeholder-title');
const stateBadge = document.getElementById('state-badge');
const stateLabel = document.getElementById('state-label');
const appIcon = document.getElementById('app-icon');
const windowLabel = document.getElementById('window-label');
const stopButton = document.getElementById('stop-button');
let currentSourceId = '';
let reportedDimensions = '';
let stream = null;

const STATUS_LABELS = Object.freeze({
  connecting: '连接中',
  error: '不可用',
  idle: '等待',
  live: '实时',
  snapshot: '快照',
  stopping: '停止中',
  unavailable: '不可用',
  waiting: '等待授权',
});

function stopStream() {
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  video.classList.remove('visible');
}

function showPlaceholder(title) {
  placeholderTitle.textContent = title;
  placeholder.classList.remove('hidden');
}

function setFallbackImage(imageUrl) {
  if (imageUrl) fallbackImage.src = imageUrl;
  else fallbackImage.removeAttribute('src');
}

function showFallback(imageUrl) {
  setFallbackImage(imageUrl);
  fallbackImage.classList.toggle('visible', Boolean(imageUrl));
}

function updateStatus(status) {
  const normalized = String(status || 'idle').toLowerCase();
  stateBadge.className = 'pip-state';
  if (['connecting', 'waiting', 'snapshot', 'stopping'].includes(normalized)) {
    stateBadge.classList.add(normalized);
  } else if (['unavailable', 'error'].includes(normalized)) {
    stateBadge.classList.add('error');
  }
  stateLabel.textContent = STATUS_LABELS[normalized] || '实时';
}

async function reportVideoDimensions() {
  const width = Number(video.videoWidth);
  const height = Number(video.videoHeight);
  if (width < 16 || height < 16) return;
  const key = `${currentSourceId}:${width}x${height}`;
  if (key === reportedDimensions) return;
  reportedDimensions = key;
  await window.meteoComputerPip.reportDimensions({ width, height });
}

async function startStream(sourceId) {
  if (!sourceId) {
    stopStream();
    currentSourceId = '';
    return false;
  }
  if (sourceId === currentSourceId && stream?.active) {
    await reportVideoDimensions();
    video.classList.add('visible');
    fallbackImage.classList.remove('visible');
    placeholder.classList.add('hidden');
    return true;
  }
  stopStream();
  currentSourceId = sourceId;
  reportedDimensions = '';
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: {
        frameRate: { max: 15 },
      },
    });
    video.srcObject = stream;
    await video.play();
    await reportVideoDimensions();
    video.classList.add('visible');
    fallbackImage.classList.remove('visible');
    placeholder.classList.add('hidden');
    const track = stream.getVideoTracks()[0];
    track?.addEventListener('ended', () => {
      if (sourceId !== currentSourceId) return;
      stopStream();
      void window.meteoComputerPip.reportStreamStatus({ sourceId, status: 'unavailable' });
      if (fallbackImage.src) {
        fallbackImage.classList.add('visible');
        placeholder.classList.add('hidden');
      } else {
        showPlaceholder('目标窗口暂不可见');
      }
    }, { once: true });
    await window.meteoComputerPip.reportStreamStatus({ sourceId, status: 'live' });
    return true;
  } catch {
    stopStream();
    await window.meteoComputerPip.reportStreamStatus({ sourceId, status: 'unavailable' });
    showPlaceholder('无法显示目标窗口');
    return false;
  }
}

async function renderState(state) {
  if (!state) return;
  windowLabel.textContent = state.windowTitle || state.appName || state.sourceName || '目标应用';
  windowLabel.title = [state.appName, state.windowTitle].filter(Boolean).join(' · ');
  stopButton.disabled = state.status === 'stopping';
  updateStatus(state.status);
  setFallbackImage(state.fallbackImage);
  fallbackImage.classList.remove('visible');

  appIcon.classList.toggle('visible', Boolean(state.appIcon));
  if (state.appIcon) appIcon.src = state.appIcon;
  else appIcon.removeAttribute('src');

  const streaming = await startStream(state.sourceId);
  if (streaming) {
    updateStatus(state.status === 'stopping' ? 'stopping' : 'live');
    fallbackImage.classList.remove('visible');
    placeholder.classList.add('hidden');
    return;
  }
  if (state.fallbackImage) {
    showFallback(state.fallbackImage);
    placeholder.classList.add('hidden');
  } else {
    const title = state.status === 'connecting'
      ? '正在连接目标窗口'
      : state.error || '目标窗口暂不可见';
    showPlaceholder(title);
  }
}

video.addEventListener('loadedmetadata', () => {
  void reportVideoDimensions();
});
document.getElementById('close-button').addEventListener('click', () => {
  void window.meteoComputerPip.control('close');
});
document.getElementById('return-button').addEventListener('click', () => {
  void window.meteoComputerPip.control('return');
});
stopButton.addEventListener('click', () => {
  stopButton.disabled = true;
  void window.meteoComputerPip.control('stop');
});

window.addEventListener('beforeunload', stopStream);
window.meteoComputerPipStartPreview = startStream;
window.meteoComputerPip.onStateChange((state) => void renderState(state));
void window.meteoComputerPip.getState().then((state) => renderState(state));
