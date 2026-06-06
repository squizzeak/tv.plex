'use strict';

const fetch = require('node-fetch');
const PlexUtil = require('../../lib/PlexUtil');

module.exports = {
  async getRecentlyAdded({ homey, query }) {
    const { serverMachineIdentifier } = query;

    if (!serverMachineIdentifier) {
      throw new Error('Missing serverMachineIdentifier');
    }

    const driver = await homey.drivers.getDriver('pms');
    const device = driver.getDevices().find(
      device => device.getData().machineIdentifier === serverMachineIdentifier,
    );
    if (!device) {
      throw new Error('Device Not Found');
    }

    const [items, apiUrl] = await Promise.all([
      device.api.getLibraryRecentlyAdded(),
      device.api.url,
    ]);
    const token = device.api.token;

    const results = await Promise.all(items.map(async (item) => {
      const title = PlexUtil.getTitle(item);
      const thumbPath = PlexUtil.getThumb(item);
      if (!thumbPath) {
        return { title, thumb: null };
      }

      try {
        const imgUrl = `${apiUrl}/photo/:/transcode?width=226&height=340&minSize=1&upscale=1&url=${encodeURIComponent(thumbPath)}&X-Plex-Token=${token}`;
        const res = await fetch(imgUrl, { timeout: 10000 });
        if (res.status !== 200) {
          return { title, thumb: null };
        }
        const buf = await res.buffer();
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        return {
          title,
          thumb: `data:${contentType};base64,${buf.toString('base64')}`,
        };
      } catch (err) {
        return { title, thumb: null };
      }
    }));

    return results;
  },
};
