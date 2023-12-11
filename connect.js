#!/usr/bin/env node

/* eslint-disable no-underscore-dangle */

require('dotenv').config();

const axios = require('axios');
const WebSocket = require('ws');
const { CookieJar } = require('tough-cookie');
const { sortBy } = require('lodash');
const { wrapper } = require('axios-cookiejar-support');

const { openDatabase } = require('./database');

const { LOGIN } = process.env;
const { PASSWORD } = process.env;

const TABLE_DEFINITION = [
  `CREATE TABLE IF NOT EXISTS bossJoins (
    joinTime TEXT,
    fightId TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS index_joinTime ON bossJoins(joinTime)`,
];

const db = openDatabase('./garden.db');

for (const definition of TABLE_DEFINITION) {
  try {
    db.prepare(definition).run();
  } catch (e) {
    console.error(e.message);
  }
}

const _getBossJoinsInLastFourHours = db
  .prepare(`SELECT COUNT(*) FROM bossJoins WHERE joinTime >= datetime('now', '-4 hours')`)
  .pluck();

function getBossJoinsInLastFourHours() {
  return _getBossJoinsInLastFourHours.get();
}

const _insertBossJoin = db.prepare(
  `INSERT INTO bossJoins (joinTime, fightId) VALUES (datetime(?), ?)`,
);

function insertBossJoin(row) {
  _insertBossJoin.run(row);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const jar = new CookieJar();

const client = wrapper(
  axios.create({
    jar,
    withCredentials: true,
  }),
);

client.interceptors.response.use(
  (response) => response,

  async (error) => {
    if (error.response?.status === 429) {
      console.error('Rate limited...');
      await sleep(2500);
      return client.request(error.config);
    }

    return Promise.reject(error);
  },
);

async function get(url) {
  return (await client.get(url)).data;
}

async function post(url, data, headers = {}) {
  if (!(data instanceof URLSearchParams)) {
    // eslint-disable-next-line no-param-reassign
    headers['Content-Type'] = 'multipart/form-data';
  }

  return client.post(url, data, { headers });
}

const MessageTypes = {
  AUTH: 0,
  NOTIFICATION_RECEIVE: 6,
  CHAT_SEND: 8,
  CHAT_RECEIVE: 9,
  MP_READ: 11,
  FIGHT_LISTEN: 12,
  FIGHT_GENERATED: 12,
  FIGHT_WAITING_POSITION: 13,
  FORUM_CHAT_DISABLE: 19,
  READ_ALL_NOTIFICATIONS: 20,
  CHAT_REQUEST_MUTE: 21,
  CHAT_MUTE_USER: 22,
  CHAT_REQUEST_UNMUTE: 23,
  CHAT_UNMUTE_USER: 24,
  YOU_ARE_MUTED: 25,
  LUCKY: 26,
  GET_LUCKY: 27,
  BATTLE_ROYALE_REGISTER: 28,
  BATTLE_ROYALE_UPDATE: 29,
  BATTLE_ROYALE_START: 30,
  BATTLE_ROYALE_LEAVE: 31,
  BATTLE_ROYALE_CHAT_NOTIF: 32,
  PONG: 33,
  CHAT_ENABLE: 34,
  CHAT_RECEIVE_PACK: 35,
  GARDEN_QUEUE_REGISTER: 37,
  GARDEN_QUEUE: 38,
  GARDEN_QUEUE_UNREGISTER: 39,
  FIGHT_PROGRESS_REGISTER: 40,
  FIGHT_PROGRESS: 41,
  FIGHT_PROGRESS_UNREGISTER: 42,
  UPDATE_LEEK_TALENT: 45,
  UPDATE_FARMER_TALENT: 46,
  UPDATE_TEAM_TALENT: 47,
  UPDATE_HABS: 48,
  UPDATE_LEEK_XP: 49,
  CHAT_CENSOR: 50,
  CHAT_REACT: 51,
  READ_NOTIFICATION: 52,
  ADD_RESOURCE: 53,
  EDITOR_HOVER: 54,
  CHAT_DELETE: 56,
  WRONG_TOKEN: 57,
  TOURNAMENT_LISTEN: 58,
  TOURNAMENT_UNLISTEN: 59,
  TOURNAMENT_UPDATE: 60,
  FAKE_LUCKY: 61,
  EDITOR_COMPLETE: 62,
  EDITOR_ANALYZE: 64,
  EDITOR_ANALYZE_ERROR: 65,
  GARDEN_BOSS_CREATE_SQUAD: 66,
  GARDEN_BOSS_JOIN_SQUAD: 67,
  GARDEN_BOSS_ADD_LEEK: 68,
  GARDEN_BOSS_REMOVE_LEEK: 69,
  GARDEN_BOSS_SQUAD_PUBLIC: 70,
  GARDEN_BOSS_ATTACK: 71,
  GARDEN_BOSS_LISTEN: 72,
  GARDEN_BOSS_SQUADS: 73,
  GARDEN_BOSS_SQUAD_JOINED: 74,
  GARDEN_BOSS_LEAVE_SQUAD: 75,
  GARDEN_BOSS_SQUAD: 76,
  GARDEN_BOSS_NO_SUCH_SQUAD: 77,
  GARDEN_BOSS_STARTED: 78,
  GARDEN_BOSS_OPEN: 79,
  GARDEN_BOSS_LOCK: 80,
  GARDEN_BOSS_UNLISTEN: 81,
  GARDEN_BOSS_LEFT: 82,
};

const TypeFromId = {};

// -> GARDEN_BOSS_CREATE_SQUAD
// <- GARDEN_BOSS_SQUAD (want boss 1)
// <- GARDEN_BOSS_SQUAD_JOINED
// -> GARDEN_BOSS_JOIN_SQUAD (with ID of previous GARDEN_BOSS_SQUAD)

for (const key of Object.keys(MessageTypes)) {
  TypeFromId[MessageTypes[key]] = key;
}

async function getFights() {
  try {
    const { fights } = await get('https://leekwars.com/api/farmer/get-from-token');
    return fights;
  } catch (e) {
    console.log(`Got error "${e.message}", logging in again...`);

    await post('https://leekwars.com/api/farmer/login-token', {
      login: LOGIN,
      password: PASSWORD,
    });

    const { fights } = await get('https://leekwars.com/api/farmer/get-from-token');
    return fights;
  }
}

(async function main() {
  let farmerId;
  let leeks;

  let socket;

  function send(message) {
    if (!socket) {
      console.log('socket did not exist');
    }

    console.log(`→ ${message}`);

    socket.send(JSON.stringify(message));
  }

  async function connect() {
    try {
      await post('https://leekwars.com/api/farmer/login-token', {
        login: LOGIN,
        password: PASSWORD,
      });

      const { farmer } = await get('https://leekwars.com/api/farmer/get-from-token');

      farmerId = farmer.id;
      leeks = sortBy(Object.keys(farmer.leeks));
    } catch (e) {
      console.error('Failed login:', e.toJSON());
      process.exit(1);
    }

    console.log({ farmerId, leeks });

    const cookies = jar.getCookieStringSync('wss://leekwars.com/ws');

    socket = new WebSocket('wss://leekwars.com/ws', {
      headers: {
        Cookie: cookies,
      },
    });

    socket.on('message', async (message) => {
      const string = message.toString('utf-8');

      const json = JSON.parse(string);
      const type = json[0];
      const data = json[1];
      const requestId = json[2];

      switch (type) {
        case MessageTypes.GARDEN_BOSS_SQUADS:
          if (data['1'].length > 0) {
            for (const squad of data['1']) {
              if (squad.engaged_count < 8 && squad.locked === false) {
                // only join at most once per four hours
                if (getBossJoinsInLastFourHours() > 0) {
                  return;
                }

                const fights = await getFights();

                console.log(`Fights available: ${fights}`);

                if (fights <= 0) {
                  console.log('Not joining because we have no fights');
                  return;
                }

                console.log(`Joining boss fight "${squad.id}"`);

                // log to database
                insertBossJoin([new Date().toISOString(), squad.id]);

                // give humans a chance to beat us
                await sleep(5000);

                send([MessageTypes.GARDEN_BOSS_JOIN_SQUAD, squad.id]);

                break;
              }
            }
          }

          break;

        case MessageTypes.LUCKY:
          await sleep(2000);

          send([MessageTypes.GET_LUCKY]);

          break;

        default:
          console.log(JSON.stringify({ type: TypeFromId[type], data, requestId }));
      }
    });

    socket.on('close', async () => {
      await sleep(1000);
      connect();
    });

    socket.on('open', () => {
      console.log('open');

      send([MessageTypes.BATTLE_ROYALE_REGISTER, 89111]);
      send([MessageTypes.GARDEN_BOSS_LISTEN]);
    });

    socket.on('error', (err) => {
      console.error(err);
    });
  }

  setInterval(() => {
    send([MessageTypes.BATTLE_ROYALE_REGISTER, 89111]);
    send([MessageTypes.GARDEN_BOSS_LISTEN]);
  }, 1000 * 60 * 5);

  await connect();
})();
