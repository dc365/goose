'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAC_APPLICATIONS = Object.freeze([
  {
    id: 'wps-office',
    name: 'WPS Office',
    paths: ['/Applications/wpsoffice.app', '/Applications/WPS Office.app'],
    extensions: ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.pdf'],
  },
  {
    id: 'microsoft-word',
    name: 'Microsoft Word',
    paths: ['/Applications/Microsoft Word.app'],
    extensions: ['.doc', '.docx'],
  },
  {
    id: 'microsoft-powerpoint',
    name: 'Microsoft PowerPoint',
    paths: ['/Applications/Microsoft PowerPoint.app'],
    extensions: ['.ppt', '.pptx'],
  },
  {
    id: 'microsoft-excel',
    name: 'Microsoft Excel',
    paths: ['/Applications/Microsoft Excel.app'],
    extensions: ['.xls', '.xlsx'],
  },
  {
    id: 'pages',
    name: 'Pages',
    paths: ['/Applications/Pages.app'],
    extensions: ['.doc', '.docx'],
  },
  {
    id: 'keynote',
    name: 'Keynote',
    paths: ['/Applications/Keynote.app'],
    extensions: ['.ppt', '.pptx'],
  },
  {
    id: 'numbers',
    name: 'Numbers',
    paths: ['/Applications/Numbers.app'],
    extensions: ['.xls', '.xlsx'],
  },
  {
    id: 'preview',
    name: '预览',
    paths: ['/System/Applications/Preview.app', '/Applications/Preview.app'],
    extensions: ['.pdf'],
  },
  {
    id: 'adobe-acrobat',
    name: 'Adobe Acrobat',
    paths: ['/Applications/Adobe Acrobat.app', '/Applications/Adobe Acrobat Reader.app'],
    extensions: ['.pdf'],
  },
  {
    id: 'libreoffice',
    name: 'LibreOffice',
    paths: ['/Applications/LibreOffice.app'],
    extensions: ['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.pdf'],
  },
]);

function macApplicationsForFile(filePath, fileExists = fs.existsSync) {
  const extension = path.extname(String(filePath || '')).toLowerCase();
  return MAC_APPLICATIONS
    .filter((application) => application.extensions.includes(extension))
    .map((application) => ({
      id: application.id,
      name: application.name,
      path: application.paths.find((candidate) => fileExists(candidate)) || null,
    }))
    .filter((application) => application.path);
}

function locationMenuLabel(platform = process.platform) {
  if (platform === 'darwin') return '在 Finder 中显示';
  if (platform === 'win32') return '在文件资源管理器中显示';
  return '在文件管理器中显示';
}

function fileClipboardCommand(filePath, platform = process.platform) {
  const target = String(filePath || '');
  if (platform === 'darwin') {
    return {
      command: 'osascript',
      args: [
        '-e', 'on run argv',
        '-e', 'set the clipboard to POSIX file (item 1 of argv)',
        '-e', 'end run',
        target,
      ],
    };
  }
  if (platform === 'win32') {
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Set-Clipboard -Path $args[0]',
        target,
      ],
    };
  }
  return null;
}

function openWithChooserCommand(filePath, platform = process.platform) {
  if (platform !== 'win32') return null;
  return {
    command: 'rundll32.exe',
    args: ['shell32.dll,OpenAs_RunDLL', String(filePath || '')],
  };
}

module.exports = {
  MAC_APPLICATIONS,
  fileClipboardCommand,
  locationMenuLabel,
  macApplicationsForFile,
  openWithChooserCommand,
};
