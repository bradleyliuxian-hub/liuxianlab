'use strict';

const { AppError } = require('./errors');
const {
  validateSearchInput,
  validateResolveInput,
  validateProviderKey,
  validateJobRequest,
} = require('./validation');

function noopMiddleware(req, res, next) {
  next();
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function createCompanyMapLookupRouter({ express, service, requireAuth, sameOrigin, getOwnerId }) {
  if (!express || typeof express.Router !== 'function') throw new Error('express is required');
  if (!service) throw new Error('service is required');
  if (typeof requireAuth !== 'function') throw new Error('requireAuth middleware is required');
  if (typeof getOwnerId !== 'function') throw new Error('getOwnerId(req) is required');

  const router = express.Router();
  const mutationGuard = typeof sameOrigin === 'function' ? sameOrigin : noopMiddleware;
  const jsonParser = express.json({ limit: '512kb' });

  router.use(requireAuth);

  router.get('/meta', (req, res) => {
    res.json({ ok: true, data: service.meta() });
  });

  router.post('/provider/validate', jsonParser, mutationGuard, asyncHandler(async (req, res, next) => {
    getOwnerId(req); // require an authenticated owner context
    const { provider, apiKey } = validateProviderKey(req.body);
    try {
      const data = await service.validateProvider({ provider, apiKey });
      res.json({ ok: true, provider: data.provider, data });
    } catch (error) {
      if (!(error instanceof AppError)) return next(error);
      res.status(error.statusCode || 400).json({
        ok: false,
        provider,
        error: { code: error.code, message: error.message },
      });
    }
  }));

  router.post('/search', jsonParser, mutationGuard, asyncHandler(async (req, res) => {
    getOwnerId(req); // prove authenticated owner context even for stateless single lookup
    const input = validateSearchInput(req.body);
    const requestedProvider = req.body && req.body.provider !== undefined
      ? String(req.body.provider || '').trim().toLowerCase()
      : '';
    const apiKey = req.body && req.body.apiKey !== undefined ? req.body.apiKey : '';
    if (requestedProvider && !['amap', 'baidu'].includes(requestedProvider)) {
      throw new AppError('VALIDATION_ERROR', 'provider 必须是 amap 或 baidu。', 400);
    }
    const resolved = service.resolveProvider({ provider: requestedProvider, apiKey });
    const result = await service.searchOne(input, resolved.provider);
    res.json({ ok: true, data: result });
  }));

  router.post('/jobs', jsonParser, mutationGuard, (req, res, next) => {
    try {
      const ownerId = String(getOwnerId(req) || '');
      if (!ownerId) throw new AppError('OWNER_CONTEXT_MISSING', '无法确定当前登录用户。', 500);
      const { provider, apiKey, items } = validateJobRequest(req.body, service.config.maxBatchSize);
      const job = service.createJob({ ownerId, items, provider, apiKey });
      res.status(202).json({ ok: true, data: job });
    } catch (error) {
      next(error);
    }
  });

  router.get('/jobs/:jobId', (req, res, next) => {
    try {
      const ownerId = String(getOwnerId(req) || '');
      const job = service.getJob({ jobId: req.params.jobId, ownerId });
      res.json({ ok: true, data: job });
    } catch (error) {
      next(error);
    }
  });

  router.get('/jobs/:jobId/results', (req, res, next) => {
    try {
      const ownerId = String(getOwnerId(req) || '');
      const result = service.getResults({
        jobId: req.params.jobId,
        ownerId,
        offset: req.query.offset,
        limit: req.query.limit,
        status: req.query.status,
        q: req.query.q,
      });
      res.json({ ok: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/jobs/:jobId/cancel', mutationGuard, (req, res, next) => {
    try {
      const ownerId = String(getOwnerId(req) || '');
      const job = service.cancelJob({ jobId: req.params.jobId, ownerId });
      res.json({ ok: true, data: job });
    } catch (error) {
      next(error);
    }
  });

  router.post('/jobs/:jobId/items/:itemId/resolve', mutationGuard, (req, res, next) => {
    try {
      const ownerId = String(getOwnerId(req) || '');
      const { poiId } = validateResolveInput(req.body);
      const item = service.resolveItem({
        jobId: req.params.jobId,
        itemId: req.params.itemId,
        ownerId,
        poiId,
      });
      res.json({ ok: true, data: item });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function companyMapLookupErrorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof AppError) {
    return res.status(error.statusCode || 400).json({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }
  return next(error);
}

module.exports = { createCompanyMapLookupRouter, companyMapLookupErrorHandler };
