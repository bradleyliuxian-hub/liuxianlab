'use strict';

const crypto = require('crypto');
const express = require('express');

const presetRepository = require('./split-preset-repository');
const {
  normalizePresetSpec,
  ValidationError
} = require('./split-routes');

class PresetValidationError extends Error {}

function validId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ''));
}

function ownerUsername(req) {
  return String(req.session?.auth?.username || '');
}

function cleanName(value) {
  const name = String(value || '').trim();
  if (!name) throw new PresetValidationError('模板名称不能为空。');
  if (name.length > 100) throw new PresetValidationError('模板名称不能超过 100 个字符。');
  return name;
}

function publicPreset(preset) {
  if (!preset) return null;
  return {
    id: preset.id,
    name: preset.name,
    spec: preset.spec,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt
  };
}

function createPresetRouter({ requireAuth, repository = presetRepository }) {
  const router = express.Router();

  router.get('/', requireAuth, async (req, res, next) => {
    try {
      const presets = await repository.listPresets(ownerUsername(req));
      return res.json({ presets: presets.map(publicPreset) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', requireAuth, async (req, res, next) => {
    try {
      const name = cleanName(req.body?.name);
      const spec = normalizePresetSpec(req.body?.spec ?? req.body);
      const preset = await repository.createPreset({
        id: crypto.randomUUID(),
        ownerUsername: ownerUsername(req),
        name,
        spec
      });
      return res.status(201).json({ preset: publicPreset(preset) });
    } catch (error) {
      if (error instanceof PresetValidationError || error instanceof ValidationError) {
        return res.status(422).json({ error: error.message });
      }
      return next(error);
    }
  });

  router.get('/:id', requireAuth, async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return res.status(404).json({ error: '模板不存在。' });
      const preset = await repository.getPreset(req.params.id, ownerUsername(req));
      if (!preset) return res.status(404).json({ error: '模板不存在。' });
      return res.json({ preset: publicPreset(preset) });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', requireAuth, async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return res.status(404).json({ error: '模板不存在。' });
      const name = req.body?.name === undefined ? null : cleanName(req.body.name);
      const spec = req.body?.spec === undefined
        ? null
        : normalizePresetSpec(req.body.spec);
      if (!name && !spec) throw new PresetValidationError('没有可更新的内容。');
      const preset = await repository.updatePreset(
        req.params.id,
        ownerUsername(req),
        { name, spec }
      );
      if (!preset) return res.status(404).json({ error: '模板不存在。' });
      return res.json({ preset: publicPreset(preset) });
    } catch (error) {
      if (error instanceof PresetValidationError || error instanceof ValidationError) {
        return res.status(422).json({ error: error.message });
      }
      return next(error);
    }
  });

  router.delete('/:id', requireAuth, async (req, res, next) => {
    try {
      if (!validId(req.params.id)) return res.status(404).json({ error: '模板不存在。' });
      const deleted = await repository.deletePreset(req.params.id, ownerUsername(req));
      if (!deleted) return res.status(404).json({ error: '模板不存在。' });
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createPresetRouter, cleanName, publicPreset };
