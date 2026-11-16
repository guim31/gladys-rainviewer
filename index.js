// -----------------------------------------------------------------------------
// Entry point of the RainViewer integration for Gladys Assistant.
//
// This file only connects the SDK: the integration itself is src/app.js,
// written against an injected client so the tests can drive it.
//
// Environment variables provided by the Gladys supervisor to the container:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
// The SDK reads them: `new GladysIntegration()` is enough. The supervisor also
// sets TZ to the time zone of Gladys, used for the radar time.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const gladys = new GladysIntegration();
const app = createApp(gladys);

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal}: stopping the radar refreshes`);
  app.stop();
});

logger.info('Starting the RainViewer integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
