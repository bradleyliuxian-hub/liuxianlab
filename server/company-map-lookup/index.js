'use strict';

const { loadConfig } = require('./config');
const { CompanyMapLookupService } = require('./service');
const { createCompanyMapLookupRouter, companyMapLookupErrorHandler } = require('./routes');

function createCompanyMapLookupModule({ express, requireAuth, sameOrigin, getOwnerId, env = process.env } = {}) {
  const config = loadConfig(env);
  const service = new CompanyMapLookupService({ config });
  const router = createCompanyMapLookupRouter({ express, service, requireAuth, sameOrigin, getOwnerId });
  return { config, service, router, errorHandler: companyMapLookupErrorHandler };
}

module.exports = {
  createCompanyMapLookupModule,
  loadConfig,
  CompanyMapLookupService,
  createCompanyMapLookupRouter,
  companyMapLookupErrorHandler,
};
