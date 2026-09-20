export const emailRegistration = () =>
  window.authSettings?.registration !== false && window.authSettings?.email !== false;
export const providerAllowed = (name, mode) =>
  !window.authSettings?.providers || window.authSettings.providers[name]?.[mode] === true;
