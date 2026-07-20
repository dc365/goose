'use strict';

let registeredServices = Object.freeze({});

function registerRuntimeServices(services = {}) {
  if (!services.profileContext || !services.capabilityService) {
    throw new Error('MeteoMate runtime services require profileContext and capabilityService');
  }
  registeredServices = Object.freeze({ ...services });
  return registeredServices;
}

function runtimeServices() {
  return registeredServices;
}

module.exports = { registerRuntimeServices, runtimeServices };
