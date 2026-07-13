const Sentry = require('@sentry/node');
const Tracing = require('@sentry/tracing');

const initSentry = (app) => {
  if (process.env.NODE_ENV === 'production') {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      integrations: [
        new Sentry.Integrations.Http({ tracing: true }),
        new Sentry.Integrations.Express({ app })
      ],
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV
    });

    app.use(Sentry.Handlers.requestHandler());
    app.use(Sentry.Handlers.tracingHandler());
  }
};

const sentryErrorHandler = () => {
  if (process.env.NODE_ENV === 'production') {
    return Sentry.Handlers.errorHandler();
  }
  return (err, req, res, next) => next(err);
};

module.exports = { initSentry, sentryErrorHandler };