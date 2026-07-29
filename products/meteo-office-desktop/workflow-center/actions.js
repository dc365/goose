(function (root) {
  'use strict';

  const api = root.MeteoMateWorkflowCenter;

  function readCapability(node) {
    if (node.type === 'tool') {
      return {
        kind: 'Tool',
        connectorId: document.getElementById('workflow-node-connector')?.value.trim() || '',
        toolName: document.getElementById('workflow-node-tool')?.value.trim() || '',
      };
    }
    if (node.type === 'workflow') {
      const [id = '', ...versionParts] = String(
        document.getElementById('workflow-node-child')?.value || ''
      ).split('@');
      return {
        kind: 'Workflow',
        id,
        version: versionParts.join('@'),
      };
    }
    return node.capability;
  }

  function readConfig(node) {
    const config = { ...(node.config || {}) };
    if (node.type === 'trigger') config.mode = document.getElementById('workflow-node-trigger-mode')?.value || 'manual';
    if (node.type === 'llm') {
      config.model = document.getElementById('workflow-node-model')?.value.trim() || '';
      config.prompt = document.getElementById('workflow-node-prompt')?.value.trim() || '';
    }
    if (node.type === 'classifier') {
      config.model = document.getElementById('workflow-node-classifier-model')?.value.trim() || '';
      config.classes = document.getElementById('workflow-node-classes')?.value.trim() || '';
      config.instruction = document.getElementById('workflow-node-classifier-instruction')?.value.trim() || '';
    }
    if (node.type === 'extractor') {
      config.model = document.getElementById('workflow-node-extractor-model')?.value.trim() || '';
      config.schema = document.getElementById('workflow-node-extractor-schema')?.value.trim() || '';
      config.instruction = document.getElementById('workflow-node-extractor-instruction')?.value.trim() || '';
    }
    if (node.type === 'knowledge') {
      config.sourceId = document.getElementById('workflow-node-source-id')?.value.trim() || '';
      config.query = document.getElementById('workflow-node-query')?.value.trim() || '';
    }
    if (node.type === 'document') config.source = document.getElementById('workflow-node-document-source')?.value.trim() || '${input.files}';
    if (node.type === 'http') {
      config.method = document.getElementById('workflow-node-http-method')?.value || 'GET';
      config.url = document.getElementById('workflow-node-http-url')?.value.trim() || '';
      config.authMode = document.getElementById('workflow-node-http-auth')?.value === 'credential' ? 'credential' : 'none';
      config.credentialRef = document.getElementById('workflow-node-http-credential')?.value.trim() || '';
      config.query = document.getElementById('workflow-node-http-query')?.value.trim() || '';
      config.headers = document.getElementById('workflow-node-http-headers')?.value.trim() || '';
      config.body = document.getElementById('workflow-node-http-body')?.value || '';
      config.responseType = ['text', 'binary'].includes(document.getElementById('workflow-node-http-response')?.value)
        ? document.getElementById('workflow-node-http-response').value
        : 'json';
    }
    if (node.type === 'code') {
      config.language = document.getElementById('workflow-node-code-language')?.value || 'javascript';
      config.source = document.getElementById('workflow-node-code-source')?.value || '';
    }
    if (node.type === 'condition') config.expression = document.getElementById('workflow-node-expression')?.value.trim() || '';
    if (node.type === 'iteration') config.items = document.getElementById('workflow-node-items')?.value.trim() || '';
    if (node.type === 'transform') config.expression = document.getElementById('workflow-node-transform')?.value.trim() || '';
    if (node.type === 'assign') config.mapping = document.getElementById('workflow-node-assign')?.value.trim() || '';
    if (node.type === 'template') config.template = document.getElementById('workflow-node-template')?.value || '';
    if (node.type === 'delay') config.seconds = Math.max(1, Math.min(86_400, Number(document.getElementById('workflow-node-delay-seconds')?.value) || 60));
    if (node.type === 'approval') config.assignee = document.getElementById('workflow-node-assignee')?.value.trim() || 'workflow-owner';
    return config;
  }

  function saveNode(event) {
    event.preventDefault();
    const nodeId = event.currentTarget.dataset.nodeId;
    const node = api.selectedWorkflow()?.spec.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    const supportsSkills = ['llm', 'classifier', 'extractor'].includes(node.type);
    api.updateNode(nodeId, {
      name: document.getElementById('workflow-node-name')?.value.trim() || node.name,
      description: document.getElementById('workflow-node-description')?.value.trim() || '',
      capability: readCapability(node),
      skills: supportsSkills
        ? [...document.querySelectorAll('input[name="workflow-node-skills"]:checked')].map((input) => ({
            id: input.value,
            version: input.dataset.skillVersion || '',
          }))
        : node.skills,
      config: readConfig(node),
      retry: {
        ...node.retry,
        maxAttempts: Math.max(1, Math.min(5, Number(document.getElementById('workflow-node-retries')?.value) || 1)),
      },
      timeoutSeconds: Math.max(60, Math.min(86_400, Number(document.getElementById('workflow-node-timeout')?.value || 15) * 60)),
      onError: document.getElementById('workflow-node-on-error')?.value === 'continue' ? 'continue' : 'abort',
    });
    render();
  }

  function commitPendingNodeForm() {
    const form = document.getElementById('workflow-node-form');
    if (form?.dataset.dirty === 'true') form.requestSubmit();
  }

  function markNodeFormDirty(form) {
    form.dataset.dirty = 'true';
    const state = document.querySelector('.workflow-save-state');
    if (!state) return;
    state.classList.add('dirty');
    const copy = state.querySelector('span');
    if (copy) copy.textContent = '节点有未保存修改';
  }

  function updateCanvasTransform() {
    const stage = document.querySelector('.workflow-canvas-stage');
    if (!stage) return;
    const viewport = api.ui.viewport;
    stage.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
    const zoomLabel = document.querySelector('.workflow-canvas-controls em');
    if (zoomLabel) zoomLabel.textContent = `${Math.round(viewport.zoom * 100)}%`;
  }

  function updateCanvasEdges() {
    document.querySelectorAll('[data-workflow-edge-path]').forEach((path) => {
      const from = document.querySelector(`.workflow-canvas-node[data-workflow-node="${CSS.escape(path.dataset.fromNode)}"]`);
      const to = document.querySelector(`.workflow-canvas-node[data-workflow-node="${CSS.escape(path.dataset.toNode)}"]`);
      if (!from || !to) return;
      const x1 = Number.parseFloat(from.style.left) + 220;
      const outputOffset = ['true', 'approved'].includes(path.dataset.fromPort)
        ? 42
        : ['false', 'rejected'].includes(path.dataset.fromPort)
          ? 82
          : 61;
      const y1 = Number.parseFloat(from.style.top) + outputOffset;
      const x2 = Number.parseFloat(to.style.left);
      const y2 = Number.parseFloat(to.style.top) + 61;
      const bend = Math.max(44, Math.abs(x2 - x1) * 0.42);
      path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
    });
  }

  function canvasWorldPoint(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - api.ui.viewport.x) / api.ui.viewport.zoom,
      y: (clientY - rect.top - api.ui.viewport.y) / api.ui.viewport.zoom,
    };
  }

  function elementWorldPoint(canvas, element) {
    const rect = element.getBoundingClientRect();
    return canvasWorldPoint(canvas, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function connectionPath(from, to) {
    const direction = to.x >= from.x ? 1 : -1;
    const bend = Math.max(44, Math.abs(to.x - from.x) * 0.42);
    return `M ${from.x} ${from.y} C ${from.x + bend * direction} ${from.y}, ${to.x - bend * direction} ${to.y}, ${to.x} ${to.y}`;
  }

  function nearestInputPort(canvas, clientX, clientY, sourceNodeId) {
    let nearest = null;
    let nearestDistance = 29;
    canvas.querySelectorAll('[data-workflow-input-port]').forEach((port) => {
      if (port.dataset.workflowInputPort === sourceNodeId) return;
      const rect = port.getBoundingClientRect();
      const distance = Math.hypot(
        clientX - (rect.left + rect.width / 2),
        clientY - (rect.top + rect.height / 2)
      );
      if (distance >= nearestDistance) return;
      nearest = port;
      nearestDistance = distance;
    });
    return nearest;
  }

  function bindConnectionDragging(canvas) {
    const preview = canvas.querySelector('[data-workflow-connection-preview]');
    const hint = canvas.closest('.workflow-canvas-shell')?.querySelector('[data-workflow-connection-hint]');
    const hintCopy = hint?.querySelector('[data-workflow-connection-hint-copy]');
    if (!preview) return;

    document.querySelectorAll('[data-workflow-output-port]').forEach((sourcePort) => {
      sourcePort.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();

        const sourceNodeId = sourcePort.dataset.workflowOutputPort;
        const sourceBranch = sourcePort.dataset.workflowPort || 'success';
        const sourceNode = api.selectedWorkflow()?.spec.nodes.find((node) => node.id === sourceNodeId);
        if (!sourceNode) return;

        let targetPort = null;
        const sourcePoint = elementWorldPoint(canvas, sourcePort);
        const setTarget = (nextTarget) => {
          if (targetPort === nextTarget) return;
          targetPort?.classList.remove('connection-target');
          targetPort?.closest('.workflow-canvas-node')?.classList.remove('connection-target');
          targetPort = nextTarget;
          targetPort?.classList.add('connection-target');
          targetPort?.closest('.workflow-canvas-node')?.classList.add('connection-target');
        };
        const update = (moveEvent) => {
          const nextTarget = nearestInputPort(
            canvas,
            moveEvent.clientX,
            moveEvent.clientY,
            sourceNodeId
          );
          setTarget(nextTarget);
          const destination = nextTarget
            ? elementWorldPoint(canvas, nextTarget)
            : canvasWorldPoint(canvas, moveEvent.clientX, moveEvent.clientY);
          preview.setAttribute('d', connectionPath(sourcePoint, destination));
        };
        const cleanup = () => {
          setTarget(null);
          sourcePort.classList.remove('dragging-connection');
          canvas.classList.remove('connecting-edge');
          preview.hidden = true;
          preview.removeAttribute('d');
          preview.classList.remove('true-branch', 'false-branch');
          document.removeEventListener('pointermove', update);
          document.removeEventListener('pointerup', finish);
          document.removeEventListener('pointercancel', cancel);
          document.removeEventListener('keydown', handleEscape);
          if (hint && !api.ui.connectingFrom) hint.hidden = true;
        };
        const finish = (finishEvent) => {
          const destination = nearestInputPort(
            canvas,
            finishEvent.clientX,
            finishEvent.clientY,
            sourceNodeId
          );
          const targetNodeId = destination?.dataset.workflowInputPort || '';
          cleanup();
          if (!targetNodeId) return;
          api.connectNodes(sourceNodeId, targetNodeId, sourceBranch);
          render();
        };
        const cancel = () => cleanup();
        const handleEscape = (keyEvent) => {
          if (keyEvent.key !== 'Escape') return;
          keyEvent.preventDefault();
          cleanup();
        };

        api.ui.connectingFrom = null;
        sourcePort.classList.add('dragging-connection');
        canvas.classList.add('connecting-edge');
        preview.hidden = false;
        preview.classList.toggle('true-branch', ['true', 'approved'].includes(sourceBranch));
        preview.classList.toggle('false-branch', ['false', 'rejected'].includes(sourceBranch));
        if (hint) {
          hint.hidden = false;
          if (hintCopy) hintCopy.textContent = '拖到目标节点左侧端口，松开完成连接';
        }
        document.addEventListener('pointermove', update);
        document.addEventListener('pointerup', finish);
        document.addEventListener('pointercancel', cancel);
        document.addEventListener('keydown', handleEscape);
        update(event);
      });
    });
  }

  function zoomCanvas(delta, anchor = null) {
    const canvas = document.querySelector('[data-workflow-canvas]');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const current = api.ui.viewport;
    const zoom = Math.max(0.35, Math.min(1.8, current.zoom + delta));
    const point = anchor || { x: rect.width / 2, y: rect.height / 2 };
    const worldX = (point.x - current.x) / current.zoom;
    const worldY = (point.y - current.y) / current.zoom;
    api.setViewport({
      zoom,
      x: point.x - worldX * zoom,
      y: point.y - worldY * zoom,
    });
    updateCanvasTransform();
  }

  function fitCanvas() {
    const workflow = api.selectedWorkflow();
    const canvas = document.querySelector('[data-workflow-canvas]');
    if (!workflow || !canvas || !workflow.spec.nodes.length) return;
    const minX = Math.min(...workflow.spec.nodes.map((node) => node.position.x));
    const minY = Math.min(...workflow.spec.nodes.map((node) => node.position.y));
    const maxX = Math.max(...workflow.spec.nodes.map((node) => node.position.x + 220));
    const maxY = Math.max(...workflow.spec.nodes.map((node) => node.position.y + 122));
    const padding = 72;
    const zoom = Math.max(0.35, Math.min(1.15,
      Math.min(
        (canvas.clientWidth - padding * 2) / Math.max(220, maxX - minX),
        (canvas.clientHeight - padding * 2) / Math.max(122, maxY - minY)
      )
    ));
    api.setViewport({
      zoom,
      x: (canvas.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (canvas.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom,
    });
    updateCanvasTransform();
  }

  function bindCanvasInteractions() {
    const canvas = document.querySelector('[data-workflow-canvas]');
    if (!canvas || api.ui.screen !== 'editor') return;

    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = canvas.getBoundingClientRect();
        zoomCanvas(event.deltaY < 0 ? 0.1 : -0.1, {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
        return;
      }
      api.setViewport({
        x: api.ui.viewport.x - event.deltaX,
        y: api.ui.viewport.y - event.deltaY,
      });
      updateCanvasTransform();
    }, { passive: false });

    canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const worldX = (localX - api.ui.viewport.x) / api.ui.viewport.zoom;
      const worldY = (localY - api.ui.viewport.y) / api.ui.viewport.zoom;
      const nodeElement = event.target.closest('.workflow-canvas-node');
      const portElement = event.target.closest('[data-workflow-output-port]');
      const nodeId = nodeElement?.dataset.workflowNode || null;
      const node = api.selectedWorkflow()?.spec.nodes.find((item) => item.id === nodeId);
      const availableWidth = rect.width - (nodeId && !api.ui.selectedNodeId ? 316 : 0);
      const connectFromNodeId = portElement?.dataset.workflowOutputPort
        || (node && !['condition', 'output'].includes(node.type) ? node.id : null);
      const fromPort = portElement?.dataset.workflowPort
        || (node?.type === 'approval' ? 'approved' : 'success');
      api.ui.selectedNodeId = nodeId || null;
      if (nodeId) api.ui.inspectorTab = 'settings';
      api.ui.paletteOpen = false;
      api.ui.contextMenu = {
        x: Math.max(8, Math.min(localX, availableWidth - 338)),
        y: Math.max(8, Math.min(localY, rect.height - 472)),
        canvasX: connectFromNodeId && node ? node.position.x + 280 : worldX,
        canvasY: connectFromNodeId && node ? node.position.y : worldY,
        connectFromNodeId,
        fromPort,
      };
      render();
    });

    canvas.addEventListener('click', (event) => {
      if (event.target.closest('.workflow-canvas-node')) return;
      if (!api.ui.selectedNodeId) return;
      api.ui.selectedNodeId = null;
      render();
    });

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('.workflow-canvas-node')) return;
      const start = {
        clientX: event.clientX,
        clientY: event.clientY,
        x: api.ui.viewport.x,
        y: api.ui.viewport.y,
      };
      canvas.classList.add('panning');
      canvas.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        api.setViewport({
          x: start.x + moveEvent.clientX - start.clientX,
          y: start.y + moveEvent.clientY - start.clientY,
        });
        updateCanvasTransform();
      };
      const finish = () => {
        canvas.classList.remove('panning');
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', finish);
        canvas.removeEventListener('pointercancel', finish);
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', finish);
      canvas.addEventListener('pointercancel', finish);
    });

    document.querySelectorAll('.workflow-canvas-node').forEach((nodeElement) => {
      nodeElement.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.closest('.workflow-port')) return;
        const nodeId = nodeElement.dataset.workflowNode;
        const node = api.selectedWorkflow()?.spec.nodes.find((item) => item.id === nodeId);
        if (!node) return;
        const start = {
          clientX: event.clientX,
          clientY: event.clientY,
          x: node.position.x,
          y: node.position.y,
        };
        let moved = false;
        nodeElement.setPointerCapture(event.pointerId);
        const move = (moveEvent) => {
          const dx = (moveEvent.clientX - start.clientX) / api.ui.viewport.zoom;
          const dy = (moveEvent.clientY - start.clientY) / api.ui.viewport.zoom;
          if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
          if (!moved) return;
          nodeElement.classList.add('dragging');
          nodeElement.style.left = `${Math.round(start.x + dx)}px`;
          nodeElement.style.top = `${Math.round(start.y + dy)}px`;
          updateCanvasEdges();
        };
        const finish = (finishEvent) => {
          nodeElement.removeEventListener('pointermove', move);
          nodeElement.removeEventListener('pointerup', finish);
          nodeElement.removeEventListener('pointercancel', finish);
          nodeElement.classList.remove('dragging');
          if (!moved) return;
          nodeElement._didDrag = true;
          api.moveNode(nodeId, {
            x: start.x + (finishEvent.clientX - start.clientX) / api.ui.viewport.zoom,
            y: start.y + (finishEvent.clientY - start.clientY) / api.ui.viewport.zoom,
          });
          render();
        };
        nodeElement.addEventListener('pointermove', move);
        nodeElement.addEventListener('pointerup', finish);
        nodeElement.addEventListener('pointercancel', finish);
      });
      nodeElement.addEventListener('keydown', (event) => {
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        api.ui.selectedNodeId = nodeElement.dataset.workflowNode;
        api.ui.inspectorTab = 'settings';
        api.ui.runDrawerOpen = false;
        render();
      });
    });

    bindConnectionDragging(canvas);
  }

  function editMetadata() {
    if (!api.selectedWorkflow()) return;
    api.ui.editingMetadata = true;
    render();
  }

  function saveMetadata(event) {
    event.preventDefault();
    api.updateWorkflowSettings({
      metadata: {
        name: document.getElementById('workflow-settings-name')?.value.trim() || '未命名工作流',
        description: document.getElementById('workflow-meta-description')?.value.trim() || '',
      },
      policy: {
        permissionProfile: document.getElementById('workflow-settings-permission')?.value || 'analysis-readonly',
        maxParallel: Math.max(1, Math.min(6, Number(document.getElementById('workflow-settings-parallel')?.value) || 3)),
        timeoutSeconds: Math.max(60, Math.min(86_400, Number(document.getElementById('workflow-settings-timeout')?.value || 30) * 60)),
        failurePolicy: document.getElementById('workflow-settings-failure')?.value === 'continue' ? 'continue' : 'abort',
        maxWorkflowDepth: Math.max(1, Math.min(5, Number(document.getElementById('workflow-settings-depth')?.value) || 3)),
      },
    });
    render();
  }

  function bindNodeSearch(input) {
    input.addEventListener('input', () => {
      const root = input.closest('.workflow-node-library, .workflow-canvas-context');
      const query = input.value.trim().toLowerCase();
      root?.querySelectorAll('[data-workflow-node-option]').forEach((option) => {
        option.hidden = Boolean(query) && !option.dataset.nodeSearch.includes(query);
      });
      root?.querySelectorAll('[data-workflow-node-group]').forEach((group) => {
        group.hidden = [...group.querySelectorAll('[data-workflow-node-option]')]
          .every((option) => option.hidden);
      });
    });
  }

  function bindEvents() {
    document.querySelectorAll('[data-workflow-create]').forEach((element) => {
      element.addEventListener('click', () => api.createWorkflow(element.dataset.workflowCreate));
    });
    document.querySelectorAll('[data-workflow-open]').forEach((element) => {
      element.addEventListener('click', () => api.openWorkflow(element.dataset.workflowOpen));
    });
    document.querySelectorAll('[data-workflow-filter]').forEach((element) => {
      element.addEventListener('click', () => {
        api.ui.filter = element.dataset.workflowFilter;
        render();
      });
    });
    document.getElementById('workflow-search')?.addEventListener('input', (event) => {
      api.ui.query = event.target.value;
      window.clearTimeout(event.target._renderTimer);
      event.target._renderTimer = window.setTimeout(render, 120);
    });
    document.querySelectorAll('[data-workflow-mode]').forEach((element) => {
      element.addEventListener('click', () => {
        commitPendingNodeForm();
        api.ui.mode = element.dataset.workflowMode === 'canvas' ? 'canvas' : 'steps';
        api.ui.contextMenu = null;
        const workflow = api.selectedWorkflow();
        if (workflow) {
          api.saveWorkflow({
            ...workflow,
            spec: {
              ...workflow.spec,
              ui: { ...workflow.spec.ui, defaultMode: api.ui.mode },
            },
          }, { quiet: true, history: false });
        }
        render();
      });
    });
    document.querySelectorAll('[data-workflow-node]').forEach((element) => {
      element.addEventListener('click', (event) => {
        if (element._didDrag || event.target.closest('.workflow-port')) {
          element._didDrag = false;
          return;
        }
        commitPendingNodeForm();
        api.ui.selectedNodeId = element.dataset.workflowNode;
        api.ui.inspectorTab = 'settings';
        api.ui.runDrawerOpen = false;
        render();
      });
    });
    document.querySelectorAll('[data-workflow-add-node]').forEach((element) => {
      element.addEventListener('click', () => api.addNode(element.dataset.workflowAddNode));
    });
    document.querySelectorAll('[data-workflow-context-add-node]').forEach((element) => {
      element.addEventListener('click', () => {
        const menu = api.ui.contextMenu;
        if (!menu) return;
        api.addNode(element.dataset.workflowContextAddNode, {
          position: { x: menu.canvasX, y: menu.canvasY },
          connectFromNodeId: menu.connectFromNodeId,
          fromPort: menu.fromPort,
        });
      });
    });
    document.querySelectorAll('[data-workflow-close-context-menu]').forEach((element) => {
      element.addEventListener('click', () => {
        api.ui.contextMenu = null;
        render();
      });
    });
    document.querySelector('[data-workflow-context-menu]')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      api.ui.contextMenu = null;
      render();
    });
    document.querySelectorAll('[data-workflow-node-search]').forEach(bindNodeSearch);
    document.querySelectorAll('[data-workflow-toggle-palette]').forEach((element) => {
      element.addEventListener('click', () => {
        api.ui.paletteOpen = !api.ui.paletteOpen;
        api.ui.contextMenu = null;
        render();
      });
    });
    document.querySelectorAll('[data-workflow-close-palette]').forEach((element) => {
      element.addEventListener('click', () => {
        api.ui.paletteOpen = false;
        render();
      });
    });
    document.querySelectorAll('[data-workflow-output-port]').forEach((element) => {
      element.addEventListener('keydown', (event) => {
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        api.ui.connectingFrom = {
          nodeId: element.dataset.workflowOutputPort,
          port: element.dataset.workflowPort || 'success',
        };
        render();
      });
    });
    document.querySelectorAll('[data-workflow-input-port]').forEach((element) => {
      element.addEventListener('keydown', (event) => {
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const targetNodeId = element.dataset.workflowInputPort;
        if (api.ui.connectingFrom) {
          const source = typeof api.ui.connectingFrom === 'string'
            ? { nodeId: api.ui.connectingFrom, port: 'success' }
            : api.ui.connectingFrom;
          api.connectNodes(source.nodeId, targetNodeId, source.port);
        }
        else {
          api.ui.selectedNodeId = targetNodeId;
          api.ui.inspectorTab = 'settings';
          api.ui.runDrawerOpen = false;
        }
        render();
      });
    });
    if (!document._meteomateWorkflowEscapeBound) {
      document._meteomateWorkflowEscapeBound = true;
      document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (api.ui.editingMetadata) {
          event.preventDefault();
          api.ui.editingMetadata = false;
          render();
          return;
        }
        if (api.ui.runDrawerOpen) {
          event.preventDefault();
          api.closeRunDrawer();
          return;
        }
        const variablePicker = document.querySelector('[data-workflow-variable-picker]');
        if (variablePicker && !variablePicker.hidden) {
          event.preventDefault();
          variablePicker.hidden = true;
          document.querySelector('[data-workflow-toggle-variables]')
            ?.setAttribute('aria-expanded', 'false');
          return;
        }
        if (!api.ui.connectingFrom) return;
        event.preventDefault();
        api.ui.connectingFrom = null;
        render();
      });
    }
    document.querySelectorAll('[data-workflow-zoom]').forEach((element) => {
      element.addEventListener('click', () => zoomCanvas(Number(element.dataset.workflowZoom) || 0));
    });
    document.querySelectorAll('[data-workflow-fit]').forEach((element) => {
      element.addEventListener('click', fitCanvas);
    });
    document.querySelectorAll('[data-workflow-remove-node]').forEach((element) => {
      element.addEventListener('click', () => api.removeNode(element.dataset.workflowRemoveNode));
    });
    document.querySelectorAll('[data-workflow-close-inspector]').forEach((element) => {
      element.addEventListener('click', () => {
        commitPendingNodeForm();
        api.ui.selectedNodeId = null;
        render();
      });
    });
    document.querySelectorAll('[data-workflow-inspector-tab]').forEach((element) => {
      element.addEventListener('click', () => {
        commitPendingNodeForm();
        api.ui.inspectorTab = element.dataset.workflowInspectorTab === 'last-run'
          ? 'last-run'
          : 'settings';
        render();
      });
    });
    document.querySelectorAll('[data-workflow-remove-edge]').forEach((element) => {
      element.addEventListener('click', () => {
        api.removeEdge(element.dataset.workflowRemoveEdge);
        render();
      });
    });
    const nodeForm = document.getElementById('workflow-node-form');
    nodeForm?.addEventListener('submit', saveNode);
    const markDirty = (event) => {
      if (event.target.closest('[data-workflow-variable-picker]')) return;
      markNodeFormDirty(nodeForm);
    };
    nodeForm?.addEventListener('input', markDirty);
    nodeForm?.addEventListener('change', markDirty);
    document.querySelectorAll('[data-workflow-variable-field]').forEach((element) => {
      element.addEventListener('focus', () => {
        api.ui.variableTargetId = element.id;
      });
    });
    document.querySelectorAll('[data-workflow-toggle-variables]').forEach((element) => {
      element.addEventListener('click', () => {
        const picker = document.querySelector('[data-workflow-variable-picker]');
        if (!picker) return;
        picker.hidden = !picker.hidden;
        element.setAttribute('aria-expanded', String(!picker.hidden));
        if (!api.ui.variableTargetId) {
          api.ui.variableTargetId = element.dataset.defaultTarget || '';
        }
        if (!picker.hidden) picker.querySelector('[data-workflow-variable-search]')?.focus();
      });
    });
    document.querySelectorAll('[data-workflow-variable-search]').forEach((input) => {
      input.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase();
        document.querySelectorAll('[data-workflow-variable-group]').forEach((group) => {
          let visible = 0;
          group.querySelectorAll('[data-workflow-insert-variable]').forEach((option) => {
            option.hidden = Boolean(query) && !option.dataset.variableSearch.includes(query);
            if (!option.hidden) visible += 1;
          });
          group.hidden = visible === 0;
        });
      });
    });
    document.querySelectorAll('[data-workflow-insert-variable]').forEach((element) => {
      element.addEventListener('click', () => {
        const toggle = document.querySelector('[data-workflow-toggle-variables]');
        const targetId = api.ui.variableTargetId || toggle?.dataset.defaultTarget || '';
        const target = document.getElementById(targetId);
        if (!target) {
          api.ui.error = '请先将光标放到支持变量的输入框中';
          render();
          return;
        }
        const reference = element.dataset.workflowInsertVariable || '';
        const start = Number.isInteger(target.selectionStart) ? target.selectionStart : target.value.length;
        const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : start;
        target.setRangeText(reference, start, end, 'end');
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.focus();
        const picker = document.querySelector('[data-workflow-variable-picker]');
        if (picker) picker.hidden = true;
        toggle?.setAttribute('aria-expanded', 'false');
      });
    });
    document.getElementById('workflow-node-child')?.addEventListener('change', (event) => {
      const version = String(event.target.value || '').split('@').slice(1).join('@');
      const input = document.getElementById('workflow-node-version');
      if (input) input.value = version;
    });
    document.getElementById('workflow-node-connector')?.addEventListener('change', (event) => {
      const connector = typeof userFacingToolCatalog === 'function'
        ? userFacingToolCatalog().find((item) => item.id === event.target.value)
        : null;
      const tools = typeof connectorTools === 'function' ? connectorTools(connector) : [];
      const datalist = document.getElementById('workflow-node-tool-options');
      if (datalist) {
        datalist.replaceChildren(...tools.map((tool) => {
          const option = document.createElement('option');
          option.value = tool.name;
          option.textContent = tool.description || tool.name;
          return option;
        }));
      }
      const toolInput = document.getElementById('workflow-node-tool');
      if (toolInput && tools.length && !tools.some((tool) => tool.name === toolInput.value)) {
        toolInput.value = tools[0].name;
      }
    });
    document.querySelectorAll('[data-workflow-edit-meta]').forEach((element) => {
      element.addEventListener('click', editMetadata);
    });
    document.querySelectorAll('[data-workflow-settings]').forEach((element) => {
      element.addEventListener('click', editMetadata);
    });
    document.getElementById('workflow-settings-form')?.addEventListener('submit', saveMetadata);
    document.querySelectorAll('[data-workflow-cancel-meta]').forEach((element) => {
      element.addEventListener('click', () => {
        api.ui.editingMetadata = false;
        render();
      });
    });
    document.querySelectorAll('[data-workflow-close]').forEach((element) => {
      element.addEventListener('click', api.closeEditor);
    });
    document.querySelectorAll('[data-workflow-publish]').forEach((element) => {
      element.addEventListener('click', api.publishSelected);
    });
    document.querySelectorAll('[data-workflow-undo]').forEach((element) => {
      element.addEventListener('click', api.undo);
    });
    document.querySelectorAll('[data-workflow-redo]').forEach((element) => {
      element.addEventListener('click', api.redo);
    });
    document.querySelectorAll('[data-workflow-run]').forEach((element) => {
      element.addEventListener('click', () => {
        commitPendingNodeForm();
        api.openRunDrawer();
      });
    });
    document.querySelectorAll('[data-workflow-open-run-drawer]').forEach((element) => {
      element.addEventListener('click', () => {
        api.openRunDrawer(element.dataset.workflowOpenRunDrawer || '');
      });
    });
    document.querySelectorAll('[data-workflow-close-run-drawer]').forEach((element) => {
      element.addEventListener('click', api.closeRunDrawer);
    });
    document.querySelectorAll('[data-workflow-run-tab]').forEach((element) => {
      element.addEventListener('click', () => {
        api.ui.runDrawerTab = element.dataset.workflowRunTab || 'input';
        render();
      });
    });
    document.querySelectorAll('[data-workflow-run-node]').forEach((element) => {
      element.addEventListener('click', () => {
        api.ui.selectedRunNodeId = element.dataset.workflowRunNode;
        api.ui.runDrawerTab = 'detail';
        render();
      });
    });
    document.getElementById('workflow-run-input-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const inputs = {};
        document.querySelectorAll('[data-workflow-run-input]').forEach((input) => {
          const name = input.dataset.workflowRunInput;
          const type = input.dataset.inputType || 'string';
          const value = input.value;
          if (type === 'boolean') inputs[name] = value === 'true';
          else if (type === 'number' || type === 'integer') inputs[name] = value === '' ? null : Number(value);
          else if (type === 'array' || type === 'object') inputs[name] = value.trim()
            ? JSON.parse(value)
            : type === 'array' ? [] : {};
          else inputs[name] = value;
        });
        api.runStructuralTest(inputs);
      } catch (error) {
        api.ui.error = `运行输入不是合法 JSON：${error.message}`;
        render();
      }
    });
    document.querySelectorAll('[data-copy-text]').forEach((element) => {
      element.addEventListener('click', () => {
        void navigator.clipboard.writeText(element.dataset.copyText || '');
        element.textContent = '已复制';
      });
    });
    document.querySelectorAll('[data-workflow-open-run]').forEach((element) => {
      element.addEventListener('click', () => {
        api.ui.selectedRunId = element.dataset.workflowOpenRun;
        api.ui.screen = 'run';
        render();
      });
    });
    document.querySelectorAll('[data-workflow-back-editor]').forEach((element) => {
      element.addEventListener('click', () => {
        api.ui.screen = 'editor';
        render();
      });
    });
    document.querySelectorAll('[data-workflow-approve]').forEach((element) => {
      element.addEventListener('click', () => api.approveSelectedRun(element.dataset.workflowApprove === 'true'));
    });
    document.querySelectorAll('[data-workflow-import]').forEach((element) => {
      element.addEventListener('click', () => void api.importWorkflow());
    });
    document.querySelectorAll('[data-workflow-export]').forEach((element) => {
      element.addEventListener('click', () => void api.exportWorkflow());
    });
    document.querySelectorAll('[data-workflow-delete]').forEach((element) => {
      element.addEventListener('click', api.deleteSelected);
    });
    bindCanvasInteractions();
    if (!document._meteomateWorkflowHistoryBound) {
      document._meteomateWorkflowHistoryBound = true;
      document.addEventListener('keydown', (event) => {
        if (!(event.metaKey || event.ctrlKey) || state.catalogTab !== 'workflows' || api.ui.screen !== 'editor') return;
        if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        const key = event.key.toLowerCase();
        if (key !== 'z' && key !== 'y') return;
        event.preventDefault();
        if (key === 'y' || event.shiftKey) api.redo();
        else api.undo();
      });
    }
    if (!document._meteomateWorkflowRunShortcutBound) {
      document._meteomateWorkflowRunShortcutBound = true;
      document.addEventListener('keydown', (event) => {
        if (!event.altKey || event.key.toLowerCase() !== 'r') return;
        if (state.catalogTab !== 'workflows' || api.ui.screen !== 'editor') return;
        if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        event.preventDefault();
        api.openRunDrawer();
      });
    }
    root.requestAnimationFrame(() => {
      const autofocus = document.getElementById('workflow-settings-name')
        || document.querySelector('.workflow-canvas-context [data-workflow-node-search]');
      autofocus?.focus();
    });
  }

  api.bindEvents = bindEvents;
})(window);
