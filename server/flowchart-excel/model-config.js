'use strict';

const fs = require('fs');
const path = require('path');

function getModelConfigStatus(env = process.env) {
  const baseUrl = String(env.FLOWCHART_BASE_URL || '').trim();
  const model = String(env.FLOWCHART_MODEL || '').trim();
  const apiKey = String(env.FLOWCHART_API_KEY || '').trim();
  const provider = String(env.FLOWCHART_PROVIDER || 'openai-compatible').trim();
  const missingVariables = [];
  if (!baseUrl) missingVariables.push('FLOWCHART_BASE_URL');
  if (!model) missingVariables.push('FLOWCHART_MODEL');
  if (baseUrl.toLowerCase().includes('api.openai.com') && !apiKey) missingVariables.push('FLOWCHART_API_KEY');
  return {
    configured: missingVariables.length === 0,
    missingVariables,
    provider
  };
}

function getPythonBin(root, env = process.env) {
  const explicit = String(env.FLOWCHART_PYTHON_BIN || '').trim();
  if (explicit) {
    if (explicit.startsWith('./') || explicit.startsWith('../')) return path.resolve(root, explicit);
    return explicit;
  }
  const venv = path.join(root, '.flowchart-venv', 'bin', 'python');
  if (fs.existsSync(venv)) return venv;
  return null;
}

module.exports = { getModelConfigStatus, getPythonBin };
