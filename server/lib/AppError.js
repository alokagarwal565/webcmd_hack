// Thrown by services/routes for classified failures. Caught by errorHandler
// and turned into the §22.1/§11.1 envelope: { error: { code, message } }.
export class AppError extends Error {
  constructor(code, message, httpStatus = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
