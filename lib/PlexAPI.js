'use strict';

const { URLSearchParams } = require('url');
const { EventEmitter } = require('events');

const xml = require('xml2js');
const WebSocketClient = require('faye-websocket').Client;

const PlexUtil = require('./PlexUtil');
const PlexError = require('./PlexError');

module.exports = class PlexAPI extends EventEmitter {

  /*
   * Static Methods
   */

  static async createPIN({
    clientId,
  } = {}) {
    if (!clientId) {
      throw new PlexError('Missing Client ID');
    }

    const body = new URLSearchParams();
    body.append('strong', 'true');

    const res = await PlexUtil.fetch({
      body,
      url: 'https://plex.tv/api/v2/pins',
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-Plex-Product': 'Homey',
        'X-Plex-Client-Identifier': clientId,
      },
    });
    const resJSON = await res.json();

    if (!res.ok) {
      throw new PlexError(resJSON.error || res.statusText);
    }

    return resJSON;
  }

  static async checkPIN({
    clientId,
    pinId,
  }) {
    if (!clientId) {
      throw new PlexError('Missing Client ID');
    }

    if (!pinId) {
      throw new PlexError('Missing PIN ID');
    }

    const res = await PlexUtil.fetch({
      url: `https://plex.tv/api/v2/pins/${pinId}`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Plex-Client-Identifier': clientId,
      },
    });
    const resJSON = await res.json();

    if (!res.ok) {
      throw new PlexError(resJSON.error || res.statusText);
    }

    return resJSON;
  }

  /*
   * Instance Methods
   */

  constructor({
    homey,
    token,
    machineIdentifier,
  } = {}) {
    super();

    this.token = token;
    this.machineIdentifier = machineIdentifier;

    this.url = null;

    this.homey = homey;
    this.homey.log(`[PlexAPI] Token: ${this.token}`);
  }

  async requireToken() {
    if (!this.token) {
      throw new PlexError('No Plex Token Provided');
    }
  }

  async requireIP() {
    await this.requireToken();

    if (!this.url) {
      this.url = Promise.resolve().then(async () => {
        this.homey.log('[PlexAPI]', 'Finding URL...');

        const servers = await this.getServers();
        const server = servers.find(server => server.clientIdentifier === this.machineIdentifier);
        if (!server) {
          throw new PlexError('Plex Media Server Unavailable');
        }

        // Test each connection
        for (const connection of Object.values(server.connections)) {
          try {
            const url = `${connection.uri}`;
            this.homey.log('[PlexAPI]', `Testing URL ${url}...`);
            const res = await PlexUtil.fetch({
              url: `${url}/identity`,
              headers: {
                'X-Plex-Token': this.token,
              },
            })

            if (res.status !== 200) {
              throw new Error(`Invalid Status Code: ${res.status}`);
            }

            return url;
          } catch (err) {
            this.homey.log('[PlexAPI]', err);

            // Try again, but without HTTPS, and bypass any 'plex.direct' URLs
            if (server.httpsRequired === '0') {
              try {
                const url = `http://${connection.address}:${connection.port}`;
                this.homey.log('[PlexAPI]', `Testing URL ${url}...`);
                const res = await PlexUtil.fetch({
                  url: `${url}/identity`,
                  headers: {
                    'X-Plex-Token': this.token,
                  },
                });

                if (res.status !== 200) {
                  throw new Error(`Invalid Status Code: ${res.status}`);
                }

                return url;
              } catch (err) {
                this.homey.log('[PlexAPI]', err);
                continue;
              }
            }

            continue;
          }
        }

        throw new Error('No working URL to Plex found. Please check your server settings.');
      });

      // eslint-disable-next-line no-console
      this.url
        .then(url => this.homey.log('[PlexAPI]', `Got URL: ${url}`))
        .catch(err => {
          this.homey.error('[PlexAPI]', err);
          this.url = null;
        });
    }

    return this.url;
  }

  /*
   * Plex Cloud API
   */

  async getServers() {
    await this.requireToken();

    const res = await PlexUtil.fetch({
      url: 'https://plex.tv/api/resources.xml?includeHttps=1',
      headers: {
        'X-Plex-Token': this.token,
      },
    });
    const resText = await res.text();
    const resXML = await xml.parseStringPromise(resText);

    if (!resXML['MediaContainer']
      || !resXML['MediaContainer']['Device']) {
      return [];
    }

    return resXML['MediaContainer']['Device']
      .filter(device => {
        return device['$']['product'] === 'Plex Media Server';
      })
      .map(server => ({
        ...server['$'],
        connections: server.Connection.map(connection => ({
          ...connection['$'],
        })),
      }));
  }

  /*
   * Plex Local API
   */

  async call({
    method,
    path,
  }) {
    await this.requireToken();
    await this.requireIP();

    const url = await this.url;
    const res = await PlexUtil.fetch({
      method,
      url: `${url}${path}`,
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': this.token,
      },
    }).catch(err => {
      this.homey.error('[PlexAPI]', err.message || err.toString());
      this.homey.error('[PlexAPI]', 'Resetting URL...');
      this.url = null;
      throw err;
    });

    if (res.status === 204) return undefined;
    if (res.headers.get('Content-Type') !== 'application/json') {
      if (res.ok) return undefined;
      throw new Error(res.statusText);
    }

    const resJSON = await res.json();

    if (!res.ok) {
      throw new PlexError(resJSON.error || res.statusText);
    }

    return resJSON;
  }

  async getLibraryRecentlyAdded() {
    const { MediaContainer } = await this.call({
      method: 'get',
      path: '/library/recentlyAdded',
    });

    if (!MediaContainer || !MediaContainer.Metadata) {
      return [];
    }

    return MediaContainer.Metadata;
  }

  async getSessions() {
    const { MediaContainer } = await this.call({
      method: 'get',
      path: '/status/sessions',
    });

    if (!MediaContainer || !MediaContainer.Metadata) {
      return [];
    }

    return MediaContainer.Metadata;
  }

  async getSession({ sessionKey }) {
    const sessions = await this.getSessions();
    const session = sessions.find(session => session.sessionKey === sessionKey);

    if (!session) {
      throw new PlexError(`Session Not Found: ${sessionKey}`);
    }

    return session;
  }

  async getSessionCached({ sessionKey }) {
    this._sessionCache = this._sessionCache || {};

    if (this._sessionCache[sessionKey]) {
      return this._sessionCache[sessionKey];
    }

    this._sessionCache[sessionKey] = await this.getSession({ sessionKey });
    return this._sessionCache[sessionKey];
  }

  async getLibrarySections() {
    const { MediaContainer } = await this.call({
      method: 'get',
      path: '/library/sections',
    });

    if (!MediaContainer || !MediaContainer.Directory) {
      return [];
    }

    return MediaContainer.Directory;
  }

  async rescanLibrary({ key }) {
    return this.call({
      method: 'get',
      path: `/library/sections/${key}/refresh`,
    });
  }

  async refreshLibrary({ key }) {
    return this.call({
      method: 'get',
      path: `/library/sections/${key}/refresh?force=1`,
    });
  }

  async getUpdaterStatus() {
    return this.call({
      method: 'get',
      path: '/updater/status',
    });
  }

  async getServerIdentity() {
    return this.call({
      method: 'get',
      path: '/identity',
    });
  }

  /*
   * WebSocket API
   */

  async connect() {
    await this.requireToken();
    await this.requireIP();

    if (!this.ws) {
      this.ws = Promise.resolve().then(async () => {
        const url = await this.url;
        await new Promise((resolve, reject) => {
          const wsurl = `${url.replace('http', 'ws')}/:/websockets/notifications?X-Plex-Token=${this.token}`;
          this.homey.log(`Connecting to ${wsurl}...`);

          if (this._ws) {
            this._ws.close();
            this._ws.removeAllListeners();
          }

          this._ws = new WebSocketClient(wsurl);
          this._ws.once('open', () => resolve(this._ws));
          this._ws.once('error', reject);
          this._ws.once('close', reject);
          this._ws.once('close', () => {
            this.homey.log('Closed');

            const reconnect = () => {
              this.homey.setTimeout(() => {
                this.homey.log('Reconnecting...');
                this.connect().catch(err => {
                  this.homey.error('Reconnect Error', err);
                  reconnect();
                });
              }, 5000);
            };
            reconnect();
          });
          this._ws.on('message', ({ data }) => {
            try {
              const message = JSON.parse(data);
              if (message['NotificationContainer']) {
                this.emit('message', message['NotificationContainer']);
              }
            } catch (err) {
              this.homey.error('Incoming Message Parse Error:', err);
            }
          });
        });

        this.homey.log('Connected');
      });

      this.ws.catch(() => {
        this.ws = null;
      });
    }
  }

  async disconnect() {
    this.homey.log('Disconnecting...');

    if (this.ws) {
      await this.ws.catch(err => this.homey.error('Disconnect Error:', err));
      this.ws = null;
    }

    if (this._ws) {
      await this._ws.close();
      await new Promise(resolve => {
        this._ws.once('close', resolve);
        this.homey.setTimeout(() => resolve(), 2500);
      });
      this._ws.removeAllListeners();
      this._ws = null;
    }
    this.homey.log('Disconnected');
  }

};
