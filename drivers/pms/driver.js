'use strict';

const PlexDriver = require('../../lib/PlexDriver');

module.exports = class PlexMediaServerDriver extends PlexDriver {

  async onInit() {
    // Server update available condition
    this.homey.flow.getConditionCard('server_update_available')
      .registerRunListener(async ({ device }) => {
        const { MediaContainer: status } = await device.api.getUpdaterStatus();
        return Boolean(status && status.canInstall);
      });

    this.homey.flow.getActionCard('rescan')
      .registerRunListener(async ({ device, library }) => {
        const { key } = library;
        return device.rescanLibrary({ key });
      })
      .registerArgumentAutocompleteListener('library', async (query, { device }) => {
        const libraries = await device.getLibrarySections();
        return libraries.map(library => ({
          name: library.title,
          key: library.key,
        }));
      });

    // Refresh
    this.homey.flow.getActionCard('refresh')
      .registerRunListener(async ({ device, library }) => {
        const { key } = library;
        return device.refreshLibrary({ key });
      })
      .registerArgumentAutocompleteListener('library', async (query, { device }) => {
        const libraries = await device.getLibrarySections();
        return libraries.map(library => ({
          name: library.title,
          key: library.key,
        }));
      });
  }

};
