'use strict';

class AppError extends Error {
  constructor(code, message, statusCode = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

class ProviderError extends AppError {
  constructor(code, message, statusCode = 502, details = undefined) {
    super(code, message, statusCode, details);
    this.name = 'ProviderError';
  }
}

module.exports = { AppError, ProviderError };
